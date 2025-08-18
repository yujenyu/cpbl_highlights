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
}: {
  keywords?: string;
  recentDays?: number;
  pageSize?: number;
}) {
  const [pages, setPages] = useState<Video[][]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hitEnd, setHitEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 用 Set 去重複（YouTube 有時分頁會重疊）
  const seenIds = useMemo(
    () => new Set(pages.flat().map((v) => v.id)),
    [pages]
  );

  const baseUrl = getBaseUrl();

  const load = useCallback(
    async (cursor?: string | null) => {
      if (loading || (hitEnd && !cursor)) return;
      setLoading(true);
      setError(null);

      const qs = new URLSearchParams();
      qs.set('limit', String(pageSize));
      qs.set('q', keywords);
      qs.set('days', String(recentDays));
      if (cursor) qs.set('pageToken', cursor);
      // ts 用於躲過中繼層快取
      qs.set('ts', String(Date.now()));

      try {
        const res = await fetch(`${baseUrl}/api/highlights?${qs.toString()}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiResp;

        // 去重
        const unique = json.items.filter((v) => !seenIds.has(v.id));

        setPages((prev) => [...prev, unique]);
        setNextPageToken(json.nextPageToken ?? null);
        if (!json.nextPageToken && unique.length === 0) {
          setHitEnd(true);
        }
      } catch (e: any) {
        setError(e?.message ?? 'Fetch failed');
      } finally {
        setLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [baseUrl, keywords, pageSize, recentDays, loading, hitEnd, seenIds]
  );

  // 首次載入或條件變動時重置
  useEffect(() => {
    setPages([]);
    setNextPageToken(null);
    setHitEnd(false);
    setError(null);
    load(null);
  }, [keywords, recentDays, pageSize]);

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

  return (
    <>
      {videos.length === 0 && !loading && !error && (
        <p className="text-gray-600">目前沒有符合條件的影片。</p>
      )}

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
          讀取發生錯誤：{error}
        </div>
      )}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((v) => (
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

      {/* 進入視窗即自動載入下一頁 */}
      <div ref={sentinelRef} className="h-8" />
    </>
  );
}
