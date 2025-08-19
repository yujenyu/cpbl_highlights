'use client';

import { useMemo, useState } from 'react';
import HighlightsList from './HighlightsList';

const TEAMS = ['樂天', '中信', '富邦', '統一', '味全', '台鋼'] as const;

export default function HighlightsControls() {
  // 單選球隊
  const [team, setTeam] = useState<(typeof TEAMS)[number] | null>(null);

  // 後端 keywords：固定只查「全場精華」（不做任何別名/OR 擴散）
  const keywords = '全場精華';

  // 前端 AND 收斂：標題同時包含「全場精華」以及（若有）所選隊名
  const titleMustAll = useMemo(() => {
    const must = ['全場精華'];
    if (team) must.push(team); // 不用別名，直接用 UI 上點選的隊名字串
    return must;
  }, [team]);

  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* 球隊快速篩選（單選） */}
        <div className="flex flex-wrap gap-2">
          {TEAMS.map((t) => {
            const active = team === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTeam(active ? null : t)}
                className={[
                  'rounded-full border px-3 py-1 text-sm transition',
                  active
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
                ].join(' ')}
                aria-pressed={active}
                aria-label={`篩選 ${t}`}
              >
                {t}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setTeam(null)}
            className="rounded-full border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50"
            aria-label="清除篩選"
          >
            全部
          </button>
        </div>
      </div>

      {/* 把條件給原本的列表元件 */}
      <HighlightsList
        keywords={keywords} // 僅「全場精華」
        recentDays={30}
        pageSize={24}
        titleMustAll={titleMustAll} // AND：全場精華 +（可選）隊名
      />
    </section>
  );
}
