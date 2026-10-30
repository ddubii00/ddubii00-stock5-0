// Isolated development fixture: synthetic prices, real scanner/auth/state handlers.
import express from 'express';
import stateHandler from '../api/state.js';
import { createMa200Scanner } from '../api/_ma200Scanner.js';
import { createScanHandler } from '../api/ma200-scan.js';
import { weeklyCloses } from '../src/utils/ma200Scan.js';
import { createCloudScanHandler } from '../api/cloud-scan.js';

const date = new Date('2026-10-08T00:00:00Z');
const bars = [];
while (bars.length < 1250) {
  if (![0, 6].includes(date.getUTCDay())) bars.unshift({ time: date.toISOString().slice(0, 10), close: 100 });
  date.setUTCDate(date.getUTCDate() - 1);
}
const names = { kospi: '코스피', kosdaq: '코스닥', nasdaq: '나스닥', japan: '일본' };
const recentWeeks = weeklyCloses(bars).slice(-4).map(row => row.time);
function withCloudRanges(rows, candle = false) {
  const weeks = weeklyCloses(rows);
  const previousDayMA = rows.slice(-21, -1).reduce((sum, row) => sum + row.close, 0) / 20;
  const previousWeekMA = weeks.slice(-21, -1).reduce((sum, row) => sum + row.close, 0) / 20;
  const up = rows.at(-1).close > rows.at(-2).close;
  const sourceDay = rows.length - 2 - 26, sourceWeek = weeks.length - 2 - 26;
  const weekIndex = new Map(weeks.map((row, i) => [row.time, i]));
  return rows.map((row, i) => {
    const recent = i >= rows.length - 85;
    const center = recent ? candle ? rows.at(-2).close : previousDayMA
      : candle ? weeks.at(-2).close : previousWeekMA;
    let high = center >= 100 ? 2 * center - 100 : 100;
    let low = center >= 100 ? 100 : 2 * center - 100;
    const wi = weekIndex.get(weeklyCloses([row])[0].time);
    const extended = recent ? i >= sourceDay - 51 && i <= sourceDay - 26
      : wi >= sourceWeek - 51 && wi <= sourceWeek - 26;
    if (extended) { if (up) low -= 4; else high += 4; }
    return { ...row, high: Math.max(high, row.close), low: Math.min(low, row.close) };
  });
}
const scanner = createMa200Scanner({
  loadUniverse: async market => ({ source: 'synthetic-test-only', sourceDate: '2026-10-09',
    items: Array.from({ length: 30 }, (_, i) => ({ symbol: `${market.toUpperCase()}${i}`, name: i === 0 ? `검증 ${names[market]} 아주 긴 종목명 자릿수 확인` : `검증 ${names[market]} 종목 ${i + 1}` })) }),
  loadWeeklyHistory: async () => weeklyCloses(bars.slice(-150)),
  loadHistory: async symbol => {
    await new Promise(resolve => setTimeout(resolve, 100));
    const rows = bars.map(bar => ({ ...bar }));
    if (!symbol.startsWith('^')) {
      if (symbol.endsWith('29')) return rows.slice(-150);
      if (symbol.endsWith('28')) return rows.slice(0, -1);
      const up = Number(symbol.match(/\d+$/)?.[0]) % 2 === 0;
      for (const row of rows) {
        const index = recentWeeks.indexOf(weeklyCloses([row])[0].time);
        if (index >= 0) row.close = (up ? [90, 80, 70, 70] : [110, 120, 130, 130])[index];
      }
      const tail = up ? [80, 75, 70, 110] : [120, 125, 130, 90];
      rows.slice(-4).forEach((row, i) => { row.close = tail[i]; });
    }
    return withCloudRanges(rows, /[23]$/.test(symbol));
  },
});
const app = express();
app.use(express.json());
app.all('/api/state', stateHandler);
app.all('/api/ma200-scan', createScanHandler(scanner));
app.all('/api/line-break-scan', createScanHandler(scanner, undefined, undefined, 'line-break'));
app.all('/api/cloud-scan', createCloudScanHandler(scanner));
app.listen(3001, '127.0.0.1', () => console.log('Isolated MA200 browser fixture listening on 3001'));
