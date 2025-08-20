'use client';

import { useEffect, useState } from 'react';
import ClipLoader from 'react-spinners/ClipLoader';

type Response = { html: string; updatedAt: string; source: string };

export default function CpblStandingsFragment() {
  const [data, setData] = useState<Response | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/records?v=1', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setData(await r.json());
      } catch (e: any) {
        setErr(e?.message ?? 'Fetch failed');
      }
    })();
  }, []);

  if (err)
    return (
      <div className="text-red-700 bg-red-50 border border-red-200 p-3 rounded">
        讀取錯誤：{err}
      </div>
    );
  if (!data)
    return (
      <div className="mb-5 rounded-xl bg-white text-black">
        <div className="grid place-items-center">
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-3 text-gray-600"
          >
            <ClipLoader color="currentColor" size={40} speedMultiplier={1} />
          </div>
        </div>
      </div>
    );

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto text-black mb-5">
      <div dangerouslySetInnerHTML={{ __html: data.html }} />
    </div>
  );
}
