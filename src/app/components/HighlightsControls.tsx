'use client';

import { useMemo, useState } from 'react';
import HighlightsList from './HighlightsList';

// 球隊常見別名
const TEAM_ALIASES: Record<string, string[]> = {
  樂天: ['樂天', '樂天桃猿', '桃猿', 'Rakuten'],
  中信: ['中信', '中信兄弟', '兄弟', 'Brothers'],
  富邦: ['富邦', '富邦悍將', '悍將', 'Fubon'],
  統一: ['統一', '統一獅', '獅', 'Uni-Lions', '7-ELEVEn'],
  味全: ['味全', '味全龍', '龍', 'Wei Chuan', 'Dragons'],
  台鋼: ['台鋼', '台鋼雄鷹', '雄鷹', 'TSG', 'Hawks'],
};

const TEAMS = Object.keys(TEAM_ALIASES);

// 逗號分隔字串（給後端 keywords）
function toCSV(tokens: string[]) {
  return tokens
    .map((t) => t.trim())
    .filter(Boolean)
    .join(',');
}

export default function HighlightsControls() {
  // 單選球隊
  const [team, setTeam] = useState<string | null>(null);

  // 送給後端的 keywords
  const keywordsCSV = useMemo(() => {
    const tokens: string[] = [];
    if (team) tokens.push(...TEAM_ALIASES[team]); // 把隊名別名也加入（擴散成超集）
    if (tokens.length === 0) tokens.push('全場精華'); // 未選球隊 → 預設關鍵字
    return toCSV(tokens);
  }, [team]);

  // 前端做 AND 收斂：標題必須同時含有的字（小寫比對）
  const titleMustAll = useMemo(() => {
    const must = ['全場精華'];
    if (team) must.push(team);
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
        keywords={keywordsCSV} // 逗號分隔（OR 擴散）
        recentDays={30}
        pageSize={24}
        titleMustAll={titleMustAll} // AND 收斂（前端嚴格過濾）
      />
    </section>
  );
}
