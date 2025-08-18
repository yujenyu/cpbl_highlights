// app/api/highlights/route.ts
import { NextResponse } from 'next/server';

// 常數與環境變數
const API_KEY = process.env.YOUTUBE_API_KEY!;
const YT_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const CPBL_CHANNEL_ID = 'UCDt9GAqyRzc2e5BNxPrwZrw';
const MAX_RESULTS = 50;

// YouTube 回應部分欄位的型別, 只留會用到的
type YTThumbnail = { url: string; width?: number; height?: number };
type YTThumbnails = {
  default?: YTThumbnail;
  medium?: YTThumbnail;
  high?: YTThumbnail;
};

interface YTSnippet {
  channelId: string;
  channelTitle: string;
  title: string;
  description?: string;
  // ISO 時間字串（UTC）
  publishedAt: string;
  thumbnails?: YTThumbnails;
}

interface YTId {
  kind?: string;
  videoId?: string;
}
interface YTItem {
  id: YTId;
  snippet?: YTSnippet;
}
interface YTSearchResponse {
  items?: YTItem[];
  nextPageToken?: string;
}

// 自定回傳給前端的精簡型
type Video = {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnail: string;
};

// 解析關鍵字（逗號分隔）, 無則預設「全場精華」
function parseKeywords(raw: string | null): string[] {
  const arr = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length > 0 ? arr : ['全場精華'];
}

// 確保必有 videoId 與 snippet
function hasVideo(
  it: YTItem
): it is Required<Pick<YTItem, 'id' | 'snippet'>> & { id: Required<YTId> } {
  return Boolean(it?.id?.videoId && it?.snippet);
}

// 檢查文字是否包含任一關鍵字（不分大小寫）
function containsAny(text: string | undefined, words: string[]) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return words.some((w) => lower.includes(w.toLowerCase()));
}

// 安全解析數字 + 範圍夾取（clamp）
function parseNumberOr(defaultValue: number, raw: string | null) {
  const n = Number(raw ?? '');
  return Number.isNaN(n) ? defaultValue : n;
}

// GET /api/highlights
// 支援查詢參數：limit（1~50）、keywords 或 q（逗號分隔關鍵字）、days（最近 N 天）
export async function GET(req: Request) {
  try {
    // 沒有 API Key 直接回 500（伺服端安全檢查）
    if (!API_KEY) {
      return NextResponse.json(
        { error: 'Missing YOUTUBE_API_KEY' },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);

    // limit 介於 1~50, 預設 50
    const limitRaw = parseNumberOr(MAX_RESULTS, searchParams.get('limit'));
    const limit = Math.min(MAX_RESULTS, Math.max(1, limitRaw));

    // 關鍵字同時支援 keywords 與 q（相容舊版/新版）
    const rawKeywordString =
      searchParams.get('keywords') ?? searchParams.get('q');
    const keywords = parseKeywords(rawKeywordString);

    // 只把第一個關鍵字送給 YouTube API, 確保能拿回較多影片, 後續再用全部關鍵字做嚴格過濾
    const keywordForYouTube = keywords[0];

    // 最近 N 天（預設 30、至少 1 天）
    const daysRaw = parseNumberOr(30, searchParams.get('days'));
    const days = Math.max(1, daysRaw);
    const publishedAfterISO = new Date(
      Date.now() - days * 86400000
    ).toISOString();

    const pageToken =
      searchParams.get('pageToken') ?? searchParams.get('cursor') ?? undefined;

    // 組合 YouTube Search API 參數
    const params = new URLSearchParams({
      key: API_KEY,
      part: 'snippet',
      type: 'video',
      order: 'date',
      channelId: CPBL_CHANNEL_ID,
      maxResults: String(limit),
      q: keywordForYouTube, // YouTube API 規格要求參數名為 q
      publishedAfter: publishedAfterISO, // 先排除太舊的影片, 減少回傳量
    });

    if (pageToken) params.set('pageToken', pageToken);

    // 呼叫 YouTube Search API
    const upstream = await fetch(`${YT_SEARCH_URL}?${params.toString()}`);
    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: `YouTube API error: ${text}` },
        { status: upstream.status }
      );
    }

    // 解析 YouTube 回應
    const data = (await upstream.json()) as YTSearchResponse;

    // 本地再做二次過濾，並轉換成前端需要的格式
    const items: Video[] = (data.items ?? [])
      .filter(hasVideo) // 型別守衛，確保一定有 id.videoId 與 snippet
      .filter((it) => {
        const s = it.snippet!;
        const inChannel = s.channelId === CPBL_CHANNEL_ID; // 只保留官方頻道影片
        const hit =
          containsAny(s.title, keywords) ||
          containsAny(s.description, keywords); // 標題或描述只要有任一關鍵字就通過
        const okDate = new Date(s.publishedAt) >= new Date(publishedAfterISO); // 只保留最近 N 天
        return inChannel && hit && okDate;
      })
      .map((it) => {
        const s = it.snippet!;
        const thumbs = s.thumbnails ?? {};
        // 由大到小依序挑選縮圖，最後若都沒有就給空字串（前端可放 placeholder）
        const thumbnail =
          thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? '';
        return {
          id: it.id.videoId!, // 已確認有值，不會出錯
          title: s.title,
          channelTitle: s.channelTitle,
          publishedAt: s.publishedAt,
          thumbnail,
        };
      });

    return NextResponse.json(
      {
        items,
        count: items.length,
        // 把 YouTube 的 nextPageToken 透出給前端
        nextPageToken: data.nextPageToken ?? null,
        debug: {
          applied: {
            channelId: CPBL_CHANNEL_ID,
            limit,
            keywords,
            keywordForYouTube,
            order: 'date',
            days,
            publishedAfterISO,
            pageToken: pageToken ?? null,
          },
        },
      },
      { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
