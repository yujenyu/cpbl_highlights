import { NextResponse } from 'next/server';

const API_KEY = process.env.YOUTUBE_API_KEY!;
const CPBL_CHANNEL_ID = 'UCDt9GAqyRzc2e5BNxPrwZrw';
const MAX_RESULTS = 50;

// 支援官方全場精華播放清單 ID（優先使用）
const FULLGAME_PLAYLIST_ID = process.env.CPBL_FULLGAME_PLAYLIST_ID ?? null;

type Video = {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnail: string;
};

// playlistItems 回應型別
type YTPlaylistItemsResp = {
  items?: Array<{
    contentDetails?: { videoId?: string; videoPublishedAt?: string };
    snippet?: {
      title?: string;
      channelTitle?: string;
      publishedAt?: string; // [NEW] 加入清單時間（備用）
      thumbnails?: {
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      };
    };
  }>;
  nextPageToken?: string;
};

// 查頻道 uploads 清單 ID
type YTChannelsResp = {
  items?: Array<{
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
};

// 解析關鍵字
function parseKeywords(raw: string | null): string[] {
  const arr = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length > 0 ? arr : ['全場精華'];
}

// 關鍵字判斷
function containsAny(text: string | undefined, words: string[]) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return words.some((w) => lower.includes(w.toLowerCase()));
}

function parseNumberOr(defaultValue: number, raw: string | null) {
  const n = Number(raw ?? '');
  return Number.isNaN(n) ? defaultValue : n;
}

// 取得頻道 uploads 清單 ID（當沒有指定 playlistId / env 時後備使用）
async function getUploadsPlaylistId() {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('key', API_KEY);
  url.searchParams.set('part', 'contentDetails');
  url.searchParams.set('id', CPBL_CHANNEL_ID);

  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`channels.list error: HTTP ${r.status}`);
  const json = (await r.json()) as YTChannelsResp;
  const uploads = json.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error('Cannot find uploads playlist for channel');
  return uploads;
}

export async function GET(req: Request) {
  try {
    if (!API_KEY) {
      return NextResponse.json(
        { error: 'Missing YOUTUBE_API_KEY' },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);

    const limitRaw = parseNumberOr(MAX_RESULTS, searchParams.get('limit'));
    const limit = Math.min(MAX_RESULTS, Math.max(1, limitRaw));

    const rawKeywordString =
      searchParams.get('keywords') ?? searchParams.get('q');
    const keywords = parseKeywords(rawKeywordString);

    // 允許前端直接指定播放清單 ID
    const explicitPlaylistId = searchParams.get('playlistId');

    // 分頁 token
    const pageToken =
      searchParams.get('pageToken') ?? searchParams.get('cursor') ?? undefined;

    // days 僅做「本地過濾」，不再送進 API（playlistItems 沒 publishedAfter）
    const daysRaw = parseNumberOr(30, searchParams.get('days'));
    const days = Math.max(0, daysRaw); // [CHANGED] 允許 0 = 不限日期
    const publishedAfterISO =
      days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : null;

    // 選擇播放清單：?playlistId → 環境變數 → 頻道 uploads
    const playlistId =
      explicitPlaylistId ??
      FULLGAME_PLAYLIST_ID ??
      (await getUploadsPlaylistId());

    // 改用 playlistItems.list（取代 search.list + publishedAfter）
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('key', API_KEY);
    url.searchParams.set('part', 'snippet,contentDetails'); // [NEW] 需要 contentDetails 拿 videoId/原始發布時間
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('maxResults', String(limit));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    // 不再設置 publishedAfter / q / type / order 等 search.list 參數

    const upstream = await fetch(url.toString());
    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: `playlistItems.list error: ${text}` },
        { status: upstream.status }
      );
    }

    const data = (await upstream.json()) as YTPlaylistItemsResp;

    // 從 playlistItems 取資料：id 用 contentDetails.videoId，publishedAt 用 videoPublishedAt
    const items: Video[] = (data.items ?? [])
      .map((it) => {
        const vid = it.contentDetails?.videoId ?? '';
        const s = it.snippet ?? {};
        const thumbs = s.thumbnails ?? {};
        const thumbnail =
          thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? '';
        const publishedAt =
          it.contentDetails?.videoPublishedAt ?? s.publishedAt ?? '';

        return {
          id: vid,
          title: s.title ?? '',
          channelTitle: s.channelTitle ?? 'CPBL',
          publishedAt,
          thumbnail,
        };
      })
      .filter((v) => v.id); // [UNCHANGED] 確保有 videoId

    // 關鍵字過濾只比對 title（playlistItems 無影片 description）
    const filteredByKeyword =
      keywords.length > 0
        ? items.filter((v) => containsAny(v.title, keywords))
        : items;

    // 日期過濾在本地端執行（若 days > 0）
    const filtered = publishedAfterISO
      ? filteredByKeyword.filter(
          (v) => new Date(v.publishedAt) >= new Date(publishedAfterISO)
        )
      : filteredByKeyword;

    return NextResponse.json(
      {
        items: filtered,
        count: filtered.length,
        nextPageToken: data.nextPageToken ?? null, // 保留供前端無限滾動
        debug: {
          // 附帶來源與使用到的 playlistId 以利除錯
          source: explicitPlaylistId
            ? 'explicit-playlist'
            : FULLGAME_PLAYLIST_ID
            ? 'env-fullgame-playlist'
            : 'uploads-playlist',
          playlistIdUsed: playlistId,
          limit,
          keywords,
          days,
          publishedAfterISO,
          pageToken: pageToken ?? null,
        },
      },
      { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
