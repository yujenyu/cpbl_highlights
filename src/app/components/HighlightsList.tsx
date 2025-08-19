'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';

type Video = {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnail: string;
};

type ApiResp = {
  items: Video[];
  count: number;
  nextPageToken: string | null;
};

// AND 過濾用的型別
type MustAll = string[];

function getBaseUrl() {
  if (typeof window !== 'undefined') return '';
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export default function HighlightsList({
  keywords = '全場精華',
  recentDays = 30,
  pageSize = 24,
  titleMustAll = [],
}: {
  keywords?: string;
  recentDays?: number;
  pageSize?: number;
  titleMustAll?: MustAll;
}) {
  const [pages, setPages] = useState<Video[][]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hitEnd, setHitEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idsRef = useRef<Set<string>>(new Set());

  // 是否至少發出過一次請求（用來控制空狀態不要閃）
  const [hasRequested, setHasRequested] = useState(false);

  // 用 localDays 來動態擴張時間窗（起始用 props.recentDays）
  const [localDays, setLocalDays] = useState<number>(recentDays);

  // 用 ref 保存最新的 days，避免擴窗後 load() 還讀到舊值
  const localDaysRef = useRef(localDays);
  useEffect(() => {
    localDaysRef.current = localDays;
  }, [localDays]);

  // 用 Set 去重（YouTube 有時分頁會重疊）
  const seenIds = useMemo(
    () => new Set(pages.flat().map((v) => v.id)),
    [pages]
  );

  const baseUrl = getBaseUrl();

  // 依目前條件載入（會帶上 localDays）
  const load = useCallback(
    async (cursor?: string | null) => {
      if (loading || (hitEnd && !cursor)) return;
      setLoading(true);
      setError(null);
      setHasRequested(true);

      const qs = new URLSearchParams();
      qs.set('limit', String(pageSize));
      qs.set('q', keywords);
      qs.set('days', String(localDaysRef.current)); // 用動態時間窗, 用 ref 讀最新 days
      if (cursor) qs.set('pageToken', cursor);
      // ts 用於躲過中繼層快取
      // qs.set('ts', String(Date.now()));
      // 把 AND 條件交給後端
      titleMustAll.forEach((t) => qs.append('mustAll', t));

      try {
        const res = await fetch(`${baseUrl}/api/highlights?${qs.toString()}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiResp;

        // 用 idsRef 去重（避免 stale seenIds）
        const unique = json.items.filter((v) => !idsRef.current.has(v.id));

        // 在 setPages 之前就把這些 id 登記起來，避免競態
        unique.forEach((v) => idsRef.current.add(v.id));

        setPages((prev) => [...prev, unique]);
        setNextPageToken(json.nextPageToken ?? null);

        // 若到達這個時間窗的最後一頁（不論這一頁有沒有新片），視為超過時間窗
        if (!json.nextPageToken) {
          setHitEnd(true);
        }

        // 判斷整輪是否為 0 筆（避免空態閃爍）
        const totalAfter = seenIds.size + unique.length;
      } catch (e: any) {
        setError(e?.message ?? 'Fetch failed');
      } finally {
        setLoading(false);
      }
    },
    [baseUrl, keywords, pageSize, loading, hitEnd, seenIds]
  );

  // 首次載入或條件變動時重置（但 localDays 會回到起始 recentDays）
  useEffect(() => {
    setPages([]);
    setNextPageToken(null);
    setHitEnd(false);
    setError(null);
    setLocalDays(recentDays);

    // 重置時把已見 id 清空
    idsRef.current.clear();

    // 立刻進入 loading，直接呼叫 load（不要 setTimeout）
    setHasRequested(false);
    setLoading(true);
    load(null);
  }, [keywords, recentDays, pageSize]);

  // 當超過時間窗時，自動把窗再往前擴 60 天，並立刻開抓新窗第一頁
  useEffect(() => {
    if (hitEnd && localDays > 0) {
      const nextDays = localDays + 60; // 可調整 30/60/90
      setHitEnd(false);
      setNextPageToken(null);
      setLocalDays(nextDays);

      // 不清空 pages，保留既有結果；靠 idsRef 去重即可
      // 不用 setTimeout、不連打，直接一次 load(null)
      load(null);
    }
  }, [hitEnd, localDays, load]);

  // IntersectionObserver 觸發下一頁
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first.isIntersecting && !loading && !hitEnd) {
          load(nextPageToken);
        }
      },
      { rootMargin: '300px 0px' }
    );

    io.observe(el);
    return () => io.disconnect();
  }, [load, loading, hitEnd, nextPageToken]);

  const videos = useMemo(() => pages.flat(), [pages]);

  // 前端做一次 AND 過濾（避免後端 keywords 的 OR 擴散太寬）
  const videosShown = useMemo(() => {
    if (!titleMustAll || titleMustAll.length === 0) return videos;
    const must = titleMustAll.map((s) => s.toLowerCase());
    return videos.filter((v) => {
      const t = v.title.toLowerCase();
      return must.every((m) => t.includes(m));
    });
  }, [videos, titleMustAll]);

  const shouldShowEmpty = hasRequested && !loading && videosShown.length === 0;

  return (
    <>
      {shouldShowEmpty && (
        <p className="text-gray-600">目前沒有符合條件的影片。</p>
      )}

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
          讀取發生錯誤：{error}
        </div>
      )}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {videosShown.map((v) => (
          <li
            key={v.id}
            className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md"
          >
            <a
              href={`https://www.youtube.com/watch?v=${v.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block no-underline"
            >
              {v.thumbnail && (
                <div
                  className="relative w-full"
                  style={{ aspectRatio: '16/9' }}
                >
                  <Image
                    src={v.thumbnail}
                    alt={v.title}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover"
                    priority={false}
                  />
                </div>
              )}
              <div className="p-3">
                <h3 className="line-clamp-2 text-base font-medium leading-snug text-gray-900">
                  {v.title}
                </h3>
                <div className="mt-0.5 text-sm text-gray-700">
                  {v.channelTitle}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {new Date(v.publishedAt).toLocaleString('zh-TW', {
                    hour12: false,
                  })}
                </div>
              </div>
            </a>
          </li>
        ))}
      </ul>

      {/* 載入狀態 / 按鈕 / Sentinel */}
      <div className="mt-4 flex items-center justify-center">
        {!hitEnd && (
          <button
            type="button"
            onClick={() => load(nextPageToken)}
            disabled={loading}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? '載入中…' : '載入更多'}
          </button>
        )}
        {hitEnd && videos.length > 0 && (
          <span className="text-sm text-gray-500">已無更多結果</span>
        )}
      </div>

      <div ref={sentinelRef} className="h-8" />
    </>
  );
}
