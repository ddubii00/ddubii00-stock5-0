import assert from 'node:assert/strict';
import { test } from 'node:test';
import { threeLineBreak, analyzeLineBreakHistory } from '../src/utils/lineBreakScan.js';
import { scanReference, weeklyCloses } from '../src/utils/ma200Scan.js';
import { createMa200Scanner } from '../api/_ma200Scanner.js';
import { createScanHandler } from '../api/ma200-scan.js';

function bars(prices, step = 1) {
  const date = new Date('2026-07-06T00:00:00Z');
  return prices.map((close, i) => {
    if (i) date.setUTCDate(date.getUTCDate() + step);
    while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
    return { time: date.toISOString().slice(0, 10), close };
  });
}

test('three generated lines, not three ordinary candles, set strict reversal thresholds', () => {
  const up = threeLineBreak(bars([100, 110, 120, 130, 115, 125, 115, 100, 99]));
  assert.equal(up.at(-1).signal, 'bearish');
  assert.equal(up.at(-1).reversalPrice, 100);
  assert.equal(up.at(-1).beforeLines, 3);
  assert.equal(up.at(-1).direction, 'down');
  assert.ok(up.slice(4, -1).every(row => !row.generated && !row.signal));
  const down = threeLineBreak(bars([100, 90, 80, 70, 85, 75, 85, 100, 101]));
  assert.equal(down.at(-1).signal, 'bullish');
  assert.equal(down.at(-1).reversalPrice, 100);
  assert.equal(down.at(-1).beforeLines, 3);
  assert.ok(down.slice(4, -1).every(row => !row.generated));
});

test('continuations, initial direction, exact threshold equality and old reversals are not fresh signals', () => {
  const continuation = threeLineBreak(bars([100, 110, 120, 130, 140]));
  assert.ok(continuation.every(row => row.signal === null));
  const reversal = threeLineBreak(bars([100, 110, 120, 130, 99, 99, 98]));
  assert.equal(reversal[4].signal, 'bearish');
  assert.equal(reversal[5].signal, null);
  assert.equal(reversal[6].signal, null);
  assert.equal(reversal[6].direction, 'down');
  assert.equal(threeLineBreak(bars([100, 90, 101])).at(-1).signal, null, 'do not claim a three-line reversal before three lines exist');
  const gaps = threeLineBreak(bars([100, 110, 120, 130, 99, 98, 97, 120, 121]));
  assert.equal(gaps.at(-2).signal, null, 'reversal starts at prior line open, and equality is not a break');
  assert.equal(gaps.at(-1).signal, 'bullish');
  assert.equal(gaps.at(-1).reversalPrice, 120);
});

test('daily and weekly latest-only reversals preserve trading dates and exclude stale or short data', () => {
  const prices = [100, 100, 110, 120, 130, 115, 120, 110, 100, 99];
  const daily = bars(prices);
  const ref = scanReference(daily);
  assert.equal(analyzeLineBreakHistory(daily, ref).day.signal, 'bearish');
  assert.equal(analyzeLineBreakHistory(daily.slice(0, -1), ref).day.status, 'stale');
  const future = [...daily, { time: '2026-12-01', close: 9999 }];
  assert.deepEqual(analyzeLineBreakHistory(future, ref), analyzeLineBreakHistory(daily, ref), 'future data cannot change a fixed session');
  const flat = daily.map(row => ({ ...row, close: 100 }));
  const short = analyzeLineBreakHistory(flat, ref).day;
  assert.equal(short.status, 'short-history');
  assert.equal(short.availableLines, 0);
  const weekly = bars([100, 90, 80, 70, 101], 7);
  weekly.at(-2).time = '2026-07-30'; // Thursday close before a Friday holiday.
  weekly.at(-1).time = '2026-08-04'; // Tuesday of an in-progress week.
  const result = analyzeLineBreakHistory(weekly, scanReference(weekly));
  assert.equal(result.week.signal, 'bullish');
  assert.equal(result.week.previous.date, '2026-07-30');
  assert.equal(result.week.latest.date, '2026-08-04');
  const staleWeek = weekly.slice(0, -1).concat({ time: '2026-08-03', close: 101 });
  assert.equal(analyzeLineBreakHistory(staleWeek, scanReference(weekly)).week.status, 'stale');
  assert.throws(() => analyzeLineBreakHistory([{ time: '2026-10-01', close: -1 }], ref));
});

test('weekly supplementation reconstructs old lines without overwriting recent daily closes', () => {
  const full = bars([100, 90, 80, 70, 101], 7);
  const ref = scanReference(full);
  const recent = full.slice(-2);
  assert.equal(analyzeLineBreakHistory(recent, ref).week.status, 'short-history');
  const native = weeklyCloses(full).map(row => ({ time: row.time, close: row.close }));
  native.at(-1).close = 9999;
  const restored = analyzeLineBreakHistory(recent, ref, native);
  assert.equal(restored.week.signal, 'bullish');
  assert.equal(restored.week.reversalPrice, 100);
  assert.equal(restored.week.latest.close, 101);
  assert.equal(restored.week.latest.date, full.at(-1).time);
  assert.equal(restored.week.supplemented, true);
});

function providers() {
  let calls = 0, active = 0, maximum = 0;
  const daily = bars(Array(1250).fill(100));
  const weeks = weeklyCloses(daily).slice(-4).map(row => row.time);
  return {
    loadUniverse: async key => ({ items: Array.from({ length: 3 }, (_, i) => ({ symbol: `${key}${i}`, name: `Stock ${key}${i}` })) }),
    loadHistory: async symbol => {
      active++; maximum = Math.max(active, maximum); calls++;
      try {
        await new Promise(resolve => setTimeout(resolve, 1));
        const result = daily.map(row => ({ ...row }));
        if (!symbol.startsWith('^')) {
          const bullish = symbol.endsWith('0') || symbol.endsWith('2');
          for (const row of result) {
            const week = weeklyCloses([row])[0].time;
            const index = weeks.indexOf(week);
            if (index >= 0) row.close = (bullish ? [90, 80, 70, 70] : [110, 120, 130, 130])[index];
          }
          const tail = bullish ? [80, 75, 70, 110] : [120, 125, 130, 90];
          result.slice(-4).forEach((row, i) => { row.close = tail[i]; });
        }
        return result;
      } finally { active--; }
    },
    stats: () => ({ calls, maximum }),
  };
}

test('MA200 and line break, both timeframes and multiple browsers share one bounded scan and checkpoint', async () => {
  const deps = providers();
  let saved;
  const scanner = createMa200Scanner({ ...deps, writeCheckpoint: async value => { saved = value; } });
  await scanner.start(false, 'line-break');
  await scanner.start(true, 'ma200');
  await scanner.start(false, 'line-break');
  await scanner.settled();
  for (const timeframe of ['day', 'week']) {
    const result = await scanner.snapshot(timeframe, 'line-break');
    assert.equal(result.status, 'done');
    assert.ok(result.markets.every(m => m.results.length === 3));
    assert.ok(result.markets.every(m => m.results.filter(row => row.signal === 'bullish').length === 2));
    assert.ok(result.markets.every(m => m.results.filter(row => row.signal === 'bearish').length === 1));
    assert.ok(result.markets.every(m => m.results.every(row => Number.isFinite(row.reversalPrice))));
    assert.ok((await scanner.snapshot(timeframe)).markets.every(m => m.results.length === 3));
  }
  assert.deepEqual(deps.stats(), { calls: 16, maximum: 2 });
  await scanner.start(false, 'ma200');
  await scanner.start(false, 'line-break');
  const restored = createMa200Scanner({ ...deps, readCheckpoint: async () => saved });
  await restored.start(false, 'line-break');
  assert.equal((await restored.snapshot('week', 'line-break')).status, 'done');
  assert.equal(deps.stats().calls, 16);
  assert.equal(saved.version, 3);
});

test('old checkpoints stay usable for MA200 and lazily backfill only missing line-break rows once', async () => {
  const deps = providers();
  let saved;
  const scanner = createMa200Scanner({ ...deps, writeCheckpoint: async value => { saved = value; } });
  await scanner.start(); await scanner.settled();
  saved.version = 2;
  saved.markets.forEach(m => m.rows.slice(0, 2).forEach(row => { delete row.lineBreak; }));
  const restored = createMa200Scanner({ ...deps, readCheckpoint: async () => saved });
  await restored.start();
  assert.equal(deps.stats().calls, 16, 'menu 6 continues to use its existing cached result');
  const pending = await restored.snapshot('day', 'line-break');
  assert.equal(pending.status, 'interrupted');
  assert.ok(pending.markets.every(m => m.completed === 1 && m.results.length === 1));
  await restored.start(false, 'line-break'); await restored.settled();
  assert.equal(deps.stats().calls, 28, 'four benchmark and eight missing-stock requests, not twelve');
  assert.ok((await restored.snapshot('week', 'line-break')).markets.every(m => m.completed === 3));
  await restored.start(false, 'line-break');
  assert.equal(deps.stats().calls, 28);
});

test('stocks younger than 201 weeks remain eligible for line break, even when MA200 weekly supplementation fails', async () => {
  const deps = providers();
  const scanner = createMa200Scanner({ ...deps,
    loadHistory: async (symbol, ...args) => (await deps.loadHistory(symbol, ...args)).slice(symbol.startsWith('^') ? -30 : -40),
    loadWeeklyHistory: async () => { throw new Error('HTTP 429'); },
  });
  await scanner.start(false, 'line-break'); await scanner.settled();
  for (const interval of ['day', 'week']) {
    const result = await scanner.snapshot(interval, 'line-break');
    assert.equal(result.status, 'done');
    assert.ok(result.markets.every(m => m.valid === 3 && m.results.length === 3 && m.excludedCount === 0));
  }
  assert.ok((await scanner.snapshot('day')).markets.every(m => m.exclusionCounts['short-history'] === 3));
  assert.ok((await scanner.snapshot('week')).markets.every(m => m.exclusionCounts.error === 3));
});

test('requesting line break during a resumed legacy job recovers missing old rows after that job settles', async () => {
  const deps = providers();
  let saved;
  const scanner = createMa200Scanner({ ...deps, writeCheckpoint: async value => { saved = value; } });
  await scanner.start(); await scanner.settled();
  saved.version = 2; saved.status = 'running';
  saved.markets.forEach(m => { m.rows = m.rows.slice(0, 2); m.completed = 2; m.rows.forEach(row => { delete row.lineBreak; }); });
  const restored = createMa200Scanner({ ...deps, readCheckpoint: async () => saved });
  await restored.start(); await restored.start(false, 'line-break'); await restored.settled();
  assert.equal((await restored.snapshot('day', 'line-break')).status, 'interrupted');
  await restored.start(false, 'line-break'); await restored.settled();
  assert.equal((await restored.snapshot('day', 'line-break')).status, 'done');
  assert.equal(deps.stats().calls, 36);
});

test('the new endpoint selects line break while keeping authentication and background-job safeguards', async () => {
  const calls = [];
  const service = { start: async (...args) => calls.push(args), snapshot: async (...args) => ({ args, markets: [] }) };
  const handler = createScanHandler(service, req => req.headers?.password === 'test', () => false, 'line-break');
  async function request(req) {
    let status = 200, data;
    const res = { status(n) { status = n; return this; }, setHeader() {}, json(value) { data = value; return this; } };
    await handler(req, res); return { status, data };
  }
  assert.equal((await request({ method: 'POST', query: {} })).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await request({ method: 'GET', headers: { password: 'test' }, query: { interval: 'minute' } })).status, 400);
  const valid = await request({ method: 'GET', headers: { password: 'test' }, query: { start: '1', interval: 'week' } });
  assert.deepEqual(valid.data.args, ['week', 'line-break']);
  assert.deepEqual(calls[0], [false, 'line-break']);
  await request({ method: 'POST', headers: { password: 'test' }, query: { interval: 'day' } });
  assert.deepEqual(calls[1], [true, 'line-break']);
});
