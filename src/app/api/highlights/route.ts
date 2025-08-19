import { NextResponse } from 'next/server';

// 使用 Edge Runtime，降低冷啟動延遲、加速 TTFB
export const runtime = 'edge';

const YT = 'https://www.googleapis.com/youtube/v3';
const API_KEY = process.env.YOUTUBE_API_KEY!;
const FULLGAME_PLAYLIST_ID = 'PL5xHQ8qHh3i-_s12NFmU2B2zhdFluJLkc';

// 回傳給前端的影片物件型別
type Video = {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnail: string;
};

// 取第一個不為 null/undefined 的值
function first<T>(...vals: (T | undefined | null)[]) {
  return vals.find((v) => v != null) as T;
}

// 將 YouTube 的 item 轉換成前端需要的 Video 格式
function toVideo(item: any): Video {
  const s = item.snippet ?? {};
  const thumbs = s.thumbnails ?? {};
  // playlistItems 會提供 contentDetails.videoPublishedAt，通常比 snippet.publishedAt 更準
  const publishedAt = first(
    item.contentDetails?.videoPublishedAt,
    s.publishedAt,
    ''
  );
  // 影片 ID 來源依序嘗試：playlistItems.resourceId.videoId -> search.item.id.videoId -> item.id
  const id = first(
    item.snippet?.resourceId?.videoId,
    item.id?.videoId,
    item.id
  );

  return {
    id,
    title: s.title ?? '',
    channelTitle: s.channelTitle ?? '',
    publishedAt,
    thumbnail: first(
      thumbs.high?.url,
      thumbs.medium?.url,
      thumbs.default?.url,
      ''
    ),
  };
}

// GET /api/highlights
export async function GET(req: Request) {
  // 環境變數檢查
  if (!API_KEY) {
    return NextResponse.json(
      { error: 'Missing YOUTUBE_API_KEY' },
      { status: 500 }
    );
  }
  if (!FULLGAME_PLAYLIST_ID) {
    return NextResponse.json(
      { error: 'Missing CPBL_FULLGAME_PLAYLIST_ID' },
      { status: 500 }
    );
  }

  const url = new URL(req.url);

  // limit：每頁回傳數量，預設 24，上限 50
  const limitIn = Number(url.searchParams.get('limit') ?? 24);
  const limit = Number.isFinite(limitIn)
    ? Math.max(1, Math.min(50, limitIn))
    : 24;

  // days：時間窗（天），預設 30；0 代表不限制
  const daysIn = Number(url.searchParams.get('days') ?? 30);
  const days = Number.isFinite(daysIn) ? Math.max(0, daysIn) : 30;
  const cutoffMs = days > 0 ? Date.now() - days * 86400000 : 0;

  // YouTube 分頁用的游標
  const pageToken = url.searchParams.get('pageToken') ?? undefined;

  // mustAll：標題 AND 篩選條件，後端過濾，降低前端無效資料
  const mustAll = url.searchParams
    .getAll('mustAll')
    .map((s) => s.toLowerCase())
    .filter(Boolean);

  // 呼叫 YouTube playlistItems API（使用播放清單穩定取得「全場精華」）
  const params = new URLSearchParams({
    part: 'snippet,contentDetails',
    playlistId: FULLGAME_PLAYLIST_ID,
    maxResults: String(limit),
    key: API_KEY,
  });
  if (pageToken) params.set('pageToken', pageToken);

  // 使用 CDN 快取（force-cache）+ ISR（revalidate: 90）降低連續請求延遲與 API 壓力
  const ytRes = await fetch(`${YT}/playlistItems?${params}`, {
    cache: 'force-cache',
    next: { revalidate: 90 },
  });
  if (!ytRes.ok) {
    return NextResponse.json(
      { error: `YouTube HTTP ${ytRes.status}` },
      { status: 502 }
    );
  }
  const yt = await ytRes.json();

  // 整理與轉換資料格式
  let items: Video[] = (yt.items ?? []).map(toVideo);

  // 依時間窗過濾（playlistItems 不支援 publishedAfter，因此在後端自行判斷）
  if (cutoffMs) {
    items = items.filter((v) => {
      const t = Date.parse(v.publishedAt);
      return Number.isFinite(t) ? t >= cutoffMs : true;
    });
  }

  // 標題 AND 過濾（所有 mustAll 字串都必須包含）
  if (mustAll.length) {
    items = items.filter((v) => {
      const t = (v.title || '').toLowerCase();
      return mustAll.every((m) => t.includes(m));
    });
  }

  // 組裝回應（包含 debug 方便前端檢視參數與來源）
  const body = {
    items,
    count: items.length,
    nextPageToken: yt.nextPageToken ?? null,
    debug: {
      source: 'env-fullgame-playlist',
      playlistIdUsed: FULLGAME_PLAYLIST_ID,
      limit,
      keywords: url.searchParams.getAll('q').length
        ? url.searchParams.getAll('q')
        : ['全場精華'],
      days,
      publishedAfterISO: cutoffMs ? new Date(cutoffMs).toISOString() : null,
      pageToken: pageToken ?? null,
    },
  };

  // 設定 Edge CDN 快取頭（s-maxage + stale-while-revalidate）
  return new NextResponse(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=90, stale-while-revalidate=60',
    },
  });
}
