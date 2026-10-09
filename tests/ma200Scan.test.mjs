import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { analyzeMa200History, crossingDirection, normalizeDailyHistory, scanReference, weeklyCloses } from '../src/utils/ma200Scan.js';
import { parseNasdaqDirectory, parseJpxWorkbook } from '../api/_scanUniverse.js';
import { createMa200Scanner } from '../api/_ma200Scanner.js';
import { createScanHandler } from '../api/ma200-scan.js';

function history(count = 1250) {
  const date = new Date('2021-01-04T00:00:00Z');
  return Array.from({ length: count }, (_, i) => {
    if (i) date.setUTCDate(date.getUTCDate() + 1);
    while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
    return { time: date.toISOString().slice(0, 10), close: i === count - 2 ? 90 : i === count - 1 ? 110 : 100 };
  });
}

test('daily signals compare each close with its own 200-close SMA, not a reused latest average', () => {
  const bars = history();
  const result = analyzeMa200History(bars, scanReference(bars.slice(-30)));
  assert.equal(result.day.signal, 'breakout');
  assert.equal(result.day.previous.ma200, 99.95);
  assert.equal(result.day.latest.ma200, 100);
  assert.equal(result.day.latest.date, bars.at(-1).time);
  bars.at(-2).close = 110;
  bars.at(-1).close = 90;
  assert.equal(analyzeMa200History(bars, scanReference(bars)).day.signal, 'breakdown');
});

test('inclusive threshold entry is supported but two equal closes on MA are not signals', () => {
  assert.equal(crossingDirection(99, 100, 100, 100), 'breakout');
  assert.equal(crossingDirection(100, 100, 101, 100), 'breakout');
  assert.equal(crossingDirection(101, 100, 100, 100), 'breakdown');
  assert.equal(crossingDirection(100, 100, 99, 100), 'breakdown');
  assert.equal(crossingDirection(100, 100, 100, 100), null);
  assert.equal(crossingDirection(101, 100, 102, 100), null);
});

test('weekly calculation uses 200 weekly last closes and preserves holiday/partial-week dates', () => {
  const bars = history();
  const grouped = weeklyCloses(bars);
  const previousWeek = grouped.at(-2).time;
  const previousDate = grouped.at(-2).lastDate;
  const latestDate = grouped.at(-1).lastDate;
  for (const bar of bars) bar.close = bar.time === previousDate ? 90 : bar.time === latestDate ? 110 : 100;
  const result = analyzeMa200History(bars, scanReference(bars.slice(-30)));
  assert.equal(result.week.signal, 'breakout');
  assert.equal(result.week.previous.ma200, 99.95);
  assert.equal(result.week.latest.ma200, 100);
  assert.equal(result.week.previous.date, previousDate);
  assert.equal(result.week.latest.date, latestDate);
  assert.equal(weeklyCloses(bars).at(-2).time, previousWeek);
  const holiday = [{ time: '2026-09-24', close: 100 }, { time: '2026-09-28', close: 110 }];
  assert.deepEqual(scanReference(holiday).day, { previous: '2026-09-24', latest: '2026-09-28' });
  assert.equal(weeklyCloses(holiday)[0].lastDate, '2026-09-24');
});

test('short histories, stale latest dates and invalid prices cannot masquerade as valid crosses', () => {
  const bars = history();
  const ref = scanReference(bars.slice(-30));
  assert.equal(analyzeMa200History(bars.slice(-200), ref).day.status, 'short-history');
  assert.equal(analyzeMa200History(bars.slice(-300), ref).week.status, 'short-history');
  assert.equal(analyzeMa200History(bars.slice(0, -1), ref).day.status, 'stale');
  assert.throws(() => normalizeDailyHistory([{ time: '2026-10-01', close: null }]));
  const normalized = normalizeDailyHistory([{ time: '20261002', close: 100 }, { time: '20261001', close: 99 }, { time: '20261002', close: 101 }]);
  assert.deepEqual(normalized.map(x => x.close), [99, 101]);
});

test('Nasdaq official directory keeps all stock listings, excludes non-stock instruments and test issues', () => {
  const head = 'Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares';
  const parsed = parseNasdaqDirectory([head, 'NVDA|NVIDIA - Common Stock|Q|N|N|100|N|N',
    'NEW|New Company - Ordinary Shares|S|N|N|100|N|N', 'ETF|Fund ETF|Q|N|N|100|Y|N',
    'TEST|Test - Common Stock|Q|Y|N|100|N|N', 'NEWU|New Company - Units|Q|N|N|100|N|N',
    'NVDA|NVIDIA - Common Stock|Q|N|N|100|N|N', 'File Creation Time: 1009202609:00|||||||'].join('\n'));
  assert.deepEqual(parsed.items.map(x => x.symbol), ['NVDA', 'NEW']);
  assert.match(parsed.sourceDate, /10092026/);
  assert.throws(() => parseNasdaqDirectory('changed format'));
});

test('JPX columns are keyed by their headers and alphanumeric stock codes remain strings', () => {
  const rows = [
    ['日付', 'コード', '銘柄名', '市場・商品区分'], ['20260930', '7203', 'トヨタ', 'プライム（内国株式）'],
    ['20260930', '130A', '新銘柄', 'グロース（内国株式）'], ['20260930', '1305', 'ETF', 'ETF・ETN'],
    ['20260930', '1234', 'PRO', 'PRO Market'],
  ];
  const xml = '<worksheet><sheetData>' + rows.map((row, i) => `<row r="${i + 1}">` + row.map((v, c) => `<c r="${String.fromCharCode(65 + c)}${i + 1}" t="inlineStr"><is><t>${v}</t></is></c>`).join('') + '</row>').join('') + '</sheetData></worksheet>';
  const parsed = parseJpxWorkbook(zipSync({ 'xl/worksheets/sheet1.xml': strToU8(xml) }));
  assert.deepEqual(parsed.items.map(x => x.symbol), ['7203.T', '130A.T']);
  assert.equal(parsed.sourceDate, '20260930');
  assert.throws(() => parseJpxWorkbook(zipSync({})), /形式|형식/);
});

function providers({ failMarket = '', outage = false } = {}) {
  const bars = history();
  let active = 0, maximum = 0, calls = 0;
  return {
    loadUniverse: async market => {
      if (market === failMarket) throw new Error('test universe unavailable');
      return { items: Array.from({ length: outage ? 8 : 3 }, (_, i) => ({ symbol: `${market}${i}`, name: `${market} stock ${i}` })), source: 'test', sourceDate: '2026-10-09' };
    },
    loadHistory: async (symbol, market) => {
      active++; maximum = Math.max(maximum, active); calls++;
      try {
        await new Promise(resolve => setTimeout(resolve, 1));
        if (outage && !symbol.startsWith('^') && market === 'nasdaq') throw new Error('HTTP 429 provider outage');
        return bars;
      } finally { active--; }
    },
    stats: () => ({ calls, maximum }),
  };
}

test('one bounded background scan produces both timeframes, shares progress, checkpoints and reuses cached results', async () => {
  const deps = providers();
  let saved;
  const scanner = createMa200Scanner({ ...deps, writeCheckpoint: async state => { saved = state; } });
  await scanner.start();
  await scanner.start(true); // A second browser cannot create a duplicate running job.
  assert.equal((await scanner.snapshot()).status, 'running');
  await scanner.settled();
  const day = await scanner.snapshot('day');
  const week = await scanner.snapshot('week');
  assert.equal(day.status, 'done');
  assert.equal(day.markets.length, 4);
  assert.ok(day.markets.every(m => m.total === 3 && m.completed === 3 && m.results.length === 3));
  assert.ok(week.markets.every(m => m.results.length === 3));
  assert.equal(deps.stats().maximum, 2);
  assert.equal(deps.stats().calls, 16);
  await scanner.start();
  assert.equal(deps.stats().calls, 16);
  assert.equal(saved.status, 'done');
  const restored = createMa200Scanner({ ...deps, readCheckpoint: async () => saved });
  assert.equal((await restored.snapshot()).status, 'done');
  await restored.start();
  assert.equal(deps.stats().calls, 16);
});

test('server restart resumes checked symbols only when the market session reference still matches', async () => {
  const deps = providers();
  let saved;
  const scanner = createMa200Scanner({ ...deps, writeCheckpoint: async data => { saved = data; } });
  await scanner.start(); await scanner.settled();
  saved.status = 'running';
  saved.markets.forEach(m => { m.rows = m.rows.slice(0, 2); m.completed = 2; });
  const before = deps.stats().calls;
  const restored = createMa200Scanner({ ...deps, readCheckpoint: async () => saved });
  await restored.start(); await restored.settled();
  assert.equal(deps.stats().calls - before, 8, 'four benchmarks and four remaining stocks');
  assert.ok((await restored.snapshot()).markets.every(m => m.completed === 3));
});

test('market listing failures and repeated provider outages stay explicitly incomplete', async () => {
  const scanner = createMa200Scanner(providers({ failMarket: 'japan', outage: true }));
  await scanner.start(); await scanner.settled();
  const result = await scanner.snapshot();
  assert.equal(result.status, 'partial');
  assert.equal(result.markets.find(m => m.key === 'japan').phase, 'error');
  const nasdaq = result.markets.find(m => m.key === 'nasdaq');
  assert.equal(nasdaq.phase, 'error');
  assert.ok(nasdaq.completed < nasdaq.total);
  assert.ok(nasdaq.exclusionCounts.error >= 5);
  const before = result.startedAt;
  await scanner.start();
  assert.equal((await scanner.snapshot()).startedAt, before, 'timeframe changes must not restart a failed scan');
});

test('scanner endpoint authenticates before starting expensive jobs and rejects invalid intervals/serverless use', async () => {
  let starts = 0;
  const service = { start: async () => { starts++; }, snapshot: async interval => ({ interval, markets: [] }) };
  const handler = createScanHandler(service, req => req.headers?.password === 'test', () => false);
  async function request(req, tool = handler) {
    let status = 200, data;
    const res = { status(n) { status = n; return this; }, setHeader() {}, json(value) { data = value; return this; } };
    await tool(req, res); return { status, data };
  }
  assert.equal((await request({ method: 'POST', query: {} })).status, 401);
  assert.equal(starts, 0);
  assert.equal((await request({ method: 'GET', headers: { password: 'test' }, query: { interval: 'minute' } })).status, 400);
  assert.equal((await request({ method: 'GET', headers: { password: 'test' }, query: { start: '1', interval: 'week' } })).data.interval, 'week');
  assert.equal(starts, 1);
  const serverless = createScanHandler(service, () => true, () => true);
  assert.equal((await request({ method: 'POST', query: {} }, serverless)).status, 503);
  assert.equal(starts, 1);
});

test('native weekly history restores old bars while recent daily closes/dates stay authoritative', () => {
  const bars = history();
  const reference = scanReference(bars);
  const native = weeklyCloses(bars).map(row => ({ time: row.time, close: row.close }));
  native.at(-1).close = 9999; // A later intraday/week update must not change the snapshot.
  const shortDaily = bars.slice(-400);
  assert.equal(analyzeMa200History(shortDaily, reference).week.status, 'short-history');
  const supplemented = analyzeMa200History(shortDaily, reference, native);
  const full = analyzeMa200History(bars, reference);
  assert.deepEqual(supplemented.day, full.day);
  assert.deepEqual(supplemented.week, { ...full.week, supplemented: true });
  assert.equal(analyzeMa200History(shortDaily.slice(0, -1), reference, native).week.status, 'stale');
  const recentListing = shortDaily.slice(-150);
  const short = analyzeMa200History(recentListing, reference, weeklyCloses(recentListing));
  assert.equal(short.week.status, 'short-history');
  assert.equal(short.week.supplemented, true);
  assert.ok(short.week.available < 201);
});

test('supplementation is requested only for weekly-short stocks, stays bounded and keeps daily signals', async () => {
  const bars = history(), reference = scanReference(bars);
  const native = weeklyCloses(bars);
  let supplements = 0, active = 0, maximum = 0;
  const scanner = createMa200Scanner({
    loadUniverse: async key => ({ items: [{ symbol: `${key}-old`, name: 'Old stock' }, { symbol: `${key}-new`, name: 'New stock' }] }),
    loadHistory: async symbol => symbol.startsWith('^') ? bars.slice(-30) : symbol.endsWith('old') ? bars.slice(-400) : bars.slice(-150),
    loadWeeklyHistory: async symbol => {
      supplements++; active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return symbol.endsWith('old') ? native : native.slice(-30);
    },
  });
  await scanner.start(); await scanner.settled();
  const week = await scanner.snapshot('week'), day = await scanner.snapshot('day');
  assert.equal(supplements, 8);
  assert.equal(maximum, 2);
  assert.ok(week.markets.every(m => m.valid === 1 && m.exclusionCounts['short-history'] === 1));
  assert.ok(day.markets.every(m => m.valid === 1));
  assert.deepEqual(week.markets[0].results[0].latest.date, reference.week.latestDate);
});

test('weekly source outages remain separate errors and stop supplemental calls without stopping daily scan', async () => {
  const bars = history();
  let weeklyCalls = 0;
  const scanner = createMa200Scanner({
    loadUniverse: async key => ({ items: key === 'nasdaq' ? Array.from({ length: 12 }, (_, i) => ({ symbol: `NEW${i}`, name: 'Stock' })) : [{ symbol: key, name: key }] }),
    loadHistory: async symbol => symbol.startsWith('^') ? bars.slice(-30) : symbol.startsWith('NEW') ? bars.slice(-400) : bars,
    loadWeeklyHistory: async () => { weeklyCalls++; throw new Error('HTTP 429'); },
  });
  await scanner.start(); await scanner.settled();
  const day = await scanner.snapshot('day'), week = await scanner.snapshot('week');
  assert.equal(day.status, 'done');
  assert.equal(week.status, 'partial');
  assert.equal(day.markets.find(m => m.key === 'nasdaq').valid, 12);
  assert.equal(week.markets.find(m => m.key === 'nasdaq').exclusionCounts['short-history'], 0);
  assert.equal(week.markets.find(m => m.key === 'nasdaq').exclusionCounts.error, 12);
  assert.ok(weeklyCalls <= 6, 'at most five failed calls plus one already in flight');
});

test('legacy checkpoint rechecks only weekly-short rows when the same session still applies', async () => {
  const deps = providers();
  let saved;
  const initial = createMa200Scanner({ ...deps, writeCheckpoint: async value => { saved = value; } });
  await initial.start(); await initial.settled();
  saved.version = 1;
  saved.markets.forEach(m => { m.rows[0].week = { status: 'short-history', available: 50 }; });
  const before = deps.stats().calls;
  const upgraded = createMa200Scanner({ ...deps, readCheckpoint: async () => saved });
  await upgraded.start(); await upgraded.settled();
  assert.equal(deps.stats().calls - before, 8, 'four benchmarks and only four legacy weekly-short stocks');
  assert.equal((await upgraded.snapshot('week')).status, 'done');
});
