// 不要用快取，每次請求都即時拿新資料
export const dynamic = 'force-dynamic';

import HighlightsControls from './components/HighlightsControls';

export default async function Home() {
  // 預設：最近 30 天、最多 50 支、關鍵字=全場精華
  // 不在伺服端抓資料，避免與 Client 無限載入重複

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
          中華職棒 全場精華
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          <a href="https://www.youtube.com/@CPBL">
            來源：CPBL 中華職棒 Youtube 官方頻道
          </a>
        </p>
      </header>

      {/* Client 無限載入（避免 SSR + Client 重複載入與重複渲染） */}
      <HighlightsControls />
    </main>
  );
}
