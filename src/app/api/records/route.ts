import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SOURCE = 'https://www.cpbl.com.tw/standings/season';

export async function GET() {
  const res = await fetch(SOURCE, {
    cache: 'no-store',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari',
      'Accept-Language': 'zh-TW,zh;q=0.9',
    },
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: `CPBL HTTP ${res.status}` },
      { status: 502 }
    );
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // 找「球隊對戰戰績」區塊
  const wrap = $('.RecordTableWrap')
    .filter((_, el) =>
      $(el).find('.record_table_caption').text().includes('球隊對戰戰績')
    )
    .first();
  if (!wrap.length) {
    return NextResponse.json(
      { error: 'Standings block not found' },
      { status: 500 }
    );
  }

  const table = wrap.find('table').first();
  const headerRow = table.find('tr').first();
  const headers = headerRow
    .children('th')
    .map((_, th) => $(th).text().replace(/\s/g, ''))
    .get();

  // 依表頭找欄位索引（避免官網微調順序就崩壞）
  const idx = (kw: string) => headers.findIndex((h) => h.includes(kw));
  const iGames = idx('出賽數');
  const iWDL = idx('勝-和-敗');
  const iWinRate = idx('勝率');
  const iGB = idx('勝差');
  const iElim = headers.findIndex((h) => h.includes('淘汰'));
  const iStreak = headers.findIndex(
    (h) => h.includes('連勝') || h.includes('連敗')
  );
  const iLast10 = idx('近十場');

  type Row = {
    rank: string;
    team: string;
    teamUrl?: string;
    games: string;
    wdl: string;
    winRate: string;
    gb: string;
    elim: string;
    streak: string;
    last10: string;
  };

  const rows: Row[] = [];

  // 逐列解析
  table
    .find('tr')
    .slice(1)
    .each((_, tr) => {
      const $tr = $(tr);
      const cells = $tr.children('td,th');
      if (!cells.length) return;

      // sticky 第一欄：同時含排名 + 球隊
      const sticky = cells.eq(0);
      const rank =
        sticky.find('.rank').text().trim() ||
        sticky.find('.rank').text().trim();
      const team =
        sticky.find('.team-w-trophy a').text().trim() ||
        sticky.find('.team-w-trophy').text().trim() ||
        sticky.text().trim();
      const teamHref = sticky.find('.team-w-trophy a').attr('href');
      const teamUrl = teamHref
        ? new URL(teamHref, SOURCE).toString()
        : undefined;

      const clean = (s: string) => (s || '').replace(/\u00a0/g, '').trim();

      const row: Row = {
        rank: clean(rank),
        team: clean(team),
        teamUrl,
        games: clean(cells.eq(iGames).text()),
        wdl: clean(cells.eq(iWDL).text()),
        winRate: clean(cells.eq(iWinRate).text()),
        gb: clean(cells.eq(iGB).text()),
        elim: iElim >= 0 ? clean(cells.eq(iElim).text()) : '',
        streak: iStreak >= 0 ? clean(cells.eq(iStreak).text()) : '',
        last10: clean(cells.eq(iLast10).text()),
      };

      // 過濾空列
      if (row.team) rows.push(row);
    });

  const colPct = (100 / 9).toFixed(4) + '%';
  const thead = `
    <thead class="bg-gray-50 text-gray-700">
      <tr>
        <th class="px-3 py-2 text-center font-medium">排名</th>
        <th class="px-3 py-2 text-left font-medium">球隊</th>
        <th class="px-3 py-2 text-center font-medium">出賽數</th>
        <th class="px-3 py-2 text-center font-medium">勝-和-敗</th>
        <th class="px-3 py-2 text-center font-medium">勝率</th>
        <th class="px-3 py-2 text-center font-medium">勝差</th>
        <th class="px-3 py-2 text-center font-medium">淘汰指數</th>
        <th class="px-3 py-2 text-center font-medium">連勝/連敗</th>
        <th class="px-3 py-2 text-center font-medium">近十場戰績</th>
      </tr>
    </thead>`;

  const tbody = `
    <tbody class="divide-y divide-gray-100">
      ${rows
        .map(
          (r, idx) => `
        <tr class="${idx % 2 ? 'bg-gray-50' : 'bg-white'}">
          <td class="px-3 py-2 text-center font-semibold">${r.rank || '-'}</td>
          <td class="px-3 py-2 whitespace-nowrap">
            ${
              r.teamUrl
                ? `<a href="${r.teamUrl}" target="_blank" rel="noreferrer" class="text-gray-900 hover:underline">${r.team}</a>`
                : `<span class="text-gray-900">${r.team}</span>`
            }
          </td>
          <td class="px-3 py-2 text-center font-mono">${r.games || '-'}</td>
          <td class="px-3 py-2 text-center font-mono">${r.wdl || '-'}</td>
          <td class="px-3 py-2 text-center font-mono">${r.winRate || '-'}</td>
          <td class="px-3 py-2 text-center font-mono">${r.gb || '-'}</td>
          <td class="px-3 py-2 text-center font-mono">${r.elim || '-'}</td>
          <td class="px-3 py-2 text-center">${r.streak || '-'}</td>
          <td class="px-3 py-2 text-center">${r.last10 || '-'}</td>
        </tr>`
        )
        .join('')}
    </tbody>`;

  const fragmentHtml = `
  <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
    <table class="min-w-full table-fixed text-sm">
      <colgroup>
        ${Array.from({ length: 9 })
          .map(() => `<col style="width:${colPct}">`)
          .join('')}
      </colgroup>
      ${thead}
      ${tbody}
    </table>
    <div class="p-2 text-xs text-gray-500">
      資料來源：<a href="${SOURCE}" target="_blank" rel="noreferrer" class="underline">CPBL 官方</a>．
      更新：${new Date().toLocaleString('zh-TW', { hour12: false })}
    </div>
  </div>`.trim();

  return new NextResponse(
    JSON.stringify({
      source: SOURCE,
      updatedAt: new Date().toISOString(),
      html: fragmentHtml, // 已整理成 9 等分欄位，排名/球隊分開
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
        'CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=120',
      },
    }
  );
}
