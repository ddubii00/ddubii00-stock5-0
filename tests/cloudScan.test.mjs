import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { analyzeCloudHistory, cloudCrossing, cloudResultForTarget, weeklyCloudBars } from '../src/utils/cloudScan.js';
import { scanReference } from '../src/utils/ma200Scan.js';
import { calculateIchimoku, calculateMA } from '../src/utils/indicators.js';
import { createMa200Scanner, fetchScanHistory, fetchScanWeeklyHistory } from '../api/_ma200Scanner.js';
import { createScanHandler } from '../api/ma200-scan.js';
import { createCloudScanHandler } from '../api/cloud-scan.js';

function history(count = 79, step = 1, colour = 'positive', direction = 'up') {
  const date = new Date('2024-01-01T00:00:00Z');
  const tail = colour === 'positive' ? 94 : 105;
  return Array.from({ length: count }, (_, i) => {
    if (i) {
      date.setUTCDate(date.getUTCDate() + step);
      if (step === 1) while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
    }
    const close = i === count - 1 ? direction === 'up' ? 250 : 1 : i >= count - 21 ? tail : 100;
    return { time: date.toISOString().slice(0, 10), close,
      high: Math.max(close, i < count - 53 && colour === 'negative' ? 130 : 110),
      low: Math.min(close, i < count - 53 && colour === 'positive' ? 70 : 90) };
  });
}

test('both cloud colours support both exits, using the same displaced cloud and SMA20 as the chart', () => {
  for (const colour of ['positive', 'negative']) for (const direction of ['up', 'down']) {
    const bars = history(79, 1, colour, direction);
    const result = analyzeCloudHistory(bars, scanReference(bars)).day;
    assert.equal(result.status, 'ready');
    assert.equal(result.previous.cloudType, colour);
    assert.equal(result.signal, direction === 'up' ? 'breakout' : 'breakdown');
    assert.ok(result.previous.ma20 >= result.previous.cloudLow && result.previous.ma20 <= result.previous.cloudHigh);
    const cloud = calculateIchimoku(bars), ma = calculateMA(bars, 20);
    assert.equal(result.latest.spanA, cloud.at(-1).senkouA);
    assert.equal(result.latest.spanB, cloud.at(-1).senkouB);
    assert.equal(result.latest.ma20, ma.at(-1).value);
    assert.equal(result.latest.date, bars.at(-1).time);
    assert.ok(direction === 'up' ? result.distancePct > 0 : result.distancePct < 0);
  }
});

test('cloud edges are inclusive only for the previous inside state; old trends, jumps across the whole cloud, and edge touches are not exits', () => {
  assert.equal(cloudCrossing(100, 90, 100, 101, 90, 100), 'breakout');
  assert.equal(cloudCrossing(90, 90, 100, 89, 90, 100), 'breakdown');
  assert.equal(cloudCrossing(95, 90, 100, 100, 90, 100), null);
  assert.equal(cloudCrossing(95, 90, 100, 90, 90, 100), null);
  assert.equal(cloudCrossing(101, 90, 100, 110, 90, 100), null);
  assert.equal(cloudCrossing(89, 90, 100, 110, 90, 100), null);
  assert.equal(cloudCrossing(105, 100, 110, 105, 90, 100), 'breakout', 'each bar uses its own moving cloud');
  assert.equal(cloudCrossing(null, 90, 100, 101, 90, 100), null);
});

test('zero-width clouds include line crossings in either direction, using each period\'s own line', () => {
  assert.equal(cloudCrossing(99, 100, 100, 101, 100, 100), 'breakout');
  assert.equal(cloudCrossing(101, 100, 100, 99, 100, 100), 'breakdown');
  assert.equal(cloudCrossing(100, 100, 100, 101, 100, 100), 'breakout');
  assert.equal(cloudCrossing(100, 100, 100, 99, 100, 100), 'breakdown');
  assert.equal(cloudCrossing(99, 100, 100, 100, 100, 100), null, 'today only touches the line');
  assert.equal(cloudCrossing(101, 100, 100, 102, 100, 100), null, 'already above yesterday');
  assert.equal(cloudCrossing(99, 100, 100, 98, 100, 100), null, 'still below');
  assert.equal(cloudCrossing(99, 100, 100, 109, 110, 110), null, 'not a crossing of the moving line');
  assert.equal(cloudCrossing(99, 100, 100, 111, 110, 110), 'breakout');
  assert.equal(cloudCrossing(101, 100, 100, 89, 90, 90), 'breakdown');
  assert.equal(cloudCrossing(89, 90, 100, 101, 100, 100), null, 'a previous nonzero cloud still requires being inside');
});

test('flat clouds support candle/SMA20 crossings on both daily and weekly histories and old cached points', () => {
  for (const step of [1, 7]) for (const direction of ['up', 'down']) {
    const bars = history(79, step).map(bar => ({ ...bar, high: 110, low: 90, close: direction === 'up' ? 99 : 101 }));
    bars.at(-1).close = direction === 'up' ? 121 : 79;
    const result = analyzeCloudHistory(bars, scanReference(bars))[step === 1 ? 'day' : 'week'];
    const expected = direction === 'up' ? 'breakout' : 'breakdown';
    assert.equal(result.previous.spanA, result.previous.spanB);
    assert.equal(result.latest.spanA, result.latest.spanB);
    assert.equal(result.signal, expected);
    assert.equal(cloudResultForTarget(result, 'candle').signal, expected);
    const oldCache = { ...result, signal: null, distancePct: 0 };
    assert.equal(cloudResultForTarget(oldCache, 'ma20').signal, expected, 'old checkpoints are re-evaluated without a full rescan');
    assert.equal(cloudResultForTarget(oldCache, 'candle').signal, expected);
    assert.equal(oldCache.signal, null, 'stored original points are not mutated');
  }
});

test('restored v5 snapshots expose new flat-line matches in both targets without loading market data', async () => {
  const now = Date.parse('2026-10-30T14:00:00Z');
  const old = { status: 'ready', signal: null, distancePct: 0,
    previous: { date: '2026-10-29', close: 101, ma20: 99, cloudLow: 100, cloudHigh: 100 },
    latest: { date: '2026-10-30', close: 99, ma20: 101, cloudLow: 100, cloudHigh: 100 } };
  const saved = { version: 5, status: 'done', updatedAt: new Date(now).toISOString(), completedAt: new Date(now).toISOString(),
    markets: ['kospi', 'kosdaq', 'nasdaq', 'japan'].map(key => ({ key, phase: 'done', total: 1,
      rows: [{ symbol: key, name: key, cloud: { day: old, week: old } }] })) };
  const noLoad = async () => { throw new Error('No provider calls allowed for cached flat-line matches'); };
  const scanner = createMa200Scanner({ now: () => now, readCheckpoint: async () => saved, loadHistory: noLoad, loadUniverse: noLoad });
  await scanner.start(false, 'cloud');
  for (const interval of ['day', 'week']) {
    assert.ok((await scanner.snapshot(interval, 'cloud')).markets.every(m => m.results[0].signal === 'breakout'));
    assert.ok((await scanner.snapshot(interval, 'cloud-candle')).markets.every(m => m.results[0].signal === 'breakdown'));
  }
  assert.equal(old.signal, null);
});

test('DB손해보험 2026-10-30 weekly regression: preserve exact small exit, but exclude genuinely inside/inside points', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/db-cloud-weekly.json', import.meta.url), 'utf8'));
  const bars = fixture.bars, result = analyzeCloudHistory(bars, scanReference(bars), bars).week;
  assert.equal(result.previous.ma20, 170880); assert.equal(result.latest.ma20, 172700);
  assert.equal(result.previous.cloudHigh, 176200); assert.equal(result.latest.cloudHigh, 172425);
  assert.equal(result.signal, 'breakout', 'actual source SMA20 is 275 above the cloud: do not invent an exclusion');
  const cloud = calculateIchimoku(bars), ma = calculateMA(bars, 20);
  assert.equal(result.latest.spanA, cloud.at(-1).senkouA); assert.equal(result.latest.ma20, ma.at(-1).value);
  const inside = { ...result, latest: { ...result.latest, ma20: 172000 } };
  assert.equal(cloudResultForTarget(inside, 'ma20').signal, null, 'inside/inside can never remain a cached breakout');
});

test('candle closes and SMA20 are independent signals; wicks alone and an already outside previous close do not qualify', () => {
  const bars = history();
  bars.slice(-21, -1).forEach(bar => { bar.close = 80; bar.low = 70; });
  bars.at(-2).close = 95;
  bars.at(-1).close = 110;
  const ma = analyzeCloudHistory(bars, scanReference(bars)).day;
  const candle = cloudResultForTarget(ma, 'candle');
  assert.equal(ma.signal, null);
  assert.equal(candle.signal, 'breakout');
  assert.equal(candle.previous.close, 95);
  assert.equal(candle.latest.close, 110);
  assert.ok(Math.abs(candle.distancePct - 10) < 1e-8);
  assert.equal(cloudResultForTarget(ma, 'ma20'), ma);
  const wickOnly = cloudResultForTarget({ ...ma, latest: { ...ma.latest, close: 95 } }, 'candle');
  assert.equal(wickOnly.signal, null);
  assert.equal(cloudResultForTarget({ ...ma, previous: { ...ma.previous, close: 101 } }, 'candle').signal, null);
  assert.equal(ma.signal, null, 'choosing candle target never mutates cached SMA signals');
  assert.equal(cloudResultForTarget({ status: 'error', error: 'missing' }, 'candle').status, 'error');
});

test('GS건설 live-response regression: both closes below the cloud are not a candle breakdown, even when SMA20 exits', () => {
  const ma = { status: 'ready', signal: 'breakdown',
    previous: { date: '2026-10-29', close: 29200, ma20: 30232.5, cloudLow: 30125, cloudHigh: 35937.5 },
    latest: { date: '2026-10-30', close: 25600, ma20: 29807.5, cloudLow: 30125, cloudHigh: 36200 } };
  assert.equal(cloudResultForTarget(ma, 'candle').signal, null);
  assert.equal(cloudResultForTarget(ma, 'ma20').signal, 'breakdown');
  const inside = { ...ma, previous: { ...ma.previous, close: 31000 } };
  assert.equal(cloudResultForTarget(inside, 'candle').signal, 'breakdown');
  assert.equal(cloudResultForTarget({ ...inside, latest: { ...inside.latest, close: 36201 } }, 'candle').signal, 'breakout');
  assert.equal(cloudResultForTarget({ ...inside, latest: { ...inside.latest, close: 36200 } }, 'candle').signal, null);
  assert.equal(cloudResultForTarget({ ...ma, previous: { ...ma.previous, close: 36000 } }, 'candle').signal, null);
});

test('irrelevant old OHLC and provider rounding must not exclude valid current daily/weekly cloud calculations', () => {
  const full = history(1250), reference = scanReference(full);
  const expected = analyzeCloudHistory(full, reference);
  const altered = full.map(row => ({ ...row }));
  altered[5].high = null; altered[6].low = 0;
  assert.deepEqual(analyzeCloudHistory(altered, reference), expected, 'years-old unused high/low errors cannot invalidate recent clouds');
  const rounded = full.map(row => ({ ...row }));
  rounded.at(-50).high = rounded.at(-50).close - 1;
  const result = analyzeCloudHistory(rounded, reference);
  assert.equal(result.day.status, 'ready', 'raw close can be one currency unit outside adjusted/rounded high, like the chart');
  assert.equal(result.week.status, 'ready');
  assert.equal(rounded.at(-50).high, rounded.at(-50).close - 1, 'never invent a high to fit the close');
  const future = [...full, { time: '2040-01-01', close: 100, high: null, low: 0 }];
  assert.deepEqual(analyzeCloudHistory(future, reference), expected);
});

test('only high/low actually needed by each displaced cloud is validated, with independent daily and weekly failures', () => {
  const full = history(1250), reference = scanReference(full);
  const badDaily = full.map(row => ({ ...row })); badDaily.at(-50).high = null;
  const dayError = analyzeCloudHistory(badDaily, reference);
  assert.equal(dayError.day.status, 'error'); assert.match(dayError.day.error, new RegExp(badDaily.at(-50).time));
  assert.equal(dayError.week.status, 'ready');
  const badWeekly = full.map(row => ({ ...row })); badWeekly.at(-180).high = null;
  const weekError = analyzeCloudHistory(badWeekly, reference);
  assert.equal(weekError.day.status, 'ready'); assert.equal(weekError.week.status, 'error');
  const notNeeded = full.map(row => ({ ...row })); notNeeded.at(-2).high = null;
  assert.equal(analyzeCloudHistory(notNeeded, reference).day.status, 'ready', 'recent candle wicks are not inputs to the already displaced cloud');
});

test('v4 overly strict cloud failures are lazily retried while valid results and MA/line-break records remain cached', async () => {
  const full = history(1250); let saved, calls = 0;
  const options = { loadUniverse: async key => ({ items: [0, 1].map(i => ({ symbol: `${key}${i}`, name: `${key}${i}` })) }),
    loadHistory: async () => { calls++; return full; }, writeCheckpoint: async value => { saved = value; } };
  const first = createMa200Scanner(options); await first.start(false, 'cloud'); await first.settled();
  saved.version = 4;
  for (const m of saved.markets) m.rows[0].cloud = { day: { status: 'error', error: '구름 계산에 필요한 실제 고가·저가 자료가 없거나 잘못되었습니다.' }, week: { status: 'error', error: '구름 계산에 필요한 실제 고가·저가 자료가 없거나 잘못되었습니다.' } };
  const originalCalls = calls;
  const restored = createMa200Scanner({ ...options, readCheckpoint: async () => saved });
  await restored.start(false, 'ma200'); assert.equal(calls, originalCalls);
  assert.equal((await restored.snapshot('day', 'cloud-candle')).status, 'interrupted');
  assert.ok((await restored.snapshot('day', 'ma200')).markets.every(m => m.completed === 2));
  await restored.start(false, 'cloud-candle'); await restored.settled();
  assert.equal(calls - originalCalls, 8, 'four benchmarks plus four failed stocks only');
  assert.equal((await restored.snapshot('day', 'cloud-candle')).status, 'done');
  assert.ok((await restored.snapshot('day', 'cloud-candle')).markets.every(m => m.valid === 2));
  assert.equal(saved.version, 5);
});

test('minimum warmup, missing real high/low and stale actual trading dates remain explicit; future bars cannot affect the reference', () => {
  const bars = history();
  const reference = scanReference(bars);
  assert.equal(analyzeCloudHistory(bars.slice(-78), reference).day.status, 'short-history');
  assert.equal(analyzeCloudHistory(bars.map(({ time, close }) => ({ time, close })), reference).day.status, 'error');
  assert.equal(analyzeCloudHistory(bars.slice(0, -1), reference).day.status, 'short-history');
  const longer = history(100);
  assert.equal(analyzeCloudHistory(longer.slice(0, -1), scanReference(longer)).day.status, 'stale');
  const future = [...bars, { time: '2030-01-01', high: 10000, low: 1, close: 9999 }];
  assert.deepEqual(analyzeCloudHistory(future, reference), analyzeCloudHistory(bars, reference));
});

test('weekly high/low aggregate the whole week and current partial week retains its actual date', () => {
  const bars = history(79, 7, 'negative', 'down');
  bars.at(-2).time = new Date(Date.parse(bars.at(-2).time) + 3 * 86400000).toISOString().slice(0, 10);
  bars.at(-1).time = new Date(Date.parse(bars.at(-1).time) + 1 * 86400000).toISOString().slice(0, 10);
  const reference = scanReference(bars);
  const result = analyzeCloudHistory(bars, reference).week;
  assert.equal(result.signal, 'breakdown');
  assert.equal(result.previous.date, bars.at(-2).time);
  assert.equal(result.latest.date, bars.at(-1).time);
  const aggregated = weeklyCloudBars([{ time: '2026-10-19', high: 200, low: 60, close: 100 }, { time: '2026-10-23', high: 120, low: 90, close: 110 }]);
  assert.deepEqual(aggregated[0], { time: '2026-10-19', high: 200, low: 60, close: 110, lastDate: '2026-10-23' });
  const stale = bars.slice(0, -1).concat({ ...bars.at(-1), time: reference.week.latest });
  assert.equal(analyzeCloudHistory(stale, reference).week.status, 'stale');
});

test('native weekly supplementation restores old cloud history but cannot replace current daily OHLC or close', () => {
  const full = history(100, 7);
  const reference = scanReference(full);
  const native = full.map(row => ({ ...row }));
  native.at(-1).close = 9999; native.at(-1).high = 9999;
  const result = analyzeCloudHistory(full.slice(-20), reference, native);
  assert.equal(result.week.status, 'ready');
  assert.equal(result.week.latest.close, full.at(-1).close);
  assert.equal(result.week.latest.ma20, calculateMA(full, 20).at(-1).value);
  assert.equal(result.week.supplemented, true);
});

test('one bounded job shares cloud/MA200/line-break results and migrates only missing legacy cloud rows', async () => {
  let calls = 0, active = 0, maximum = 0, saved;
  const bars = history(1250);
  const options = { loadUniverse: async key => ({ items: [0, 1].map(i => ({ symbol: `${key}${i}`, name: `${key}${i}` })) }),
    loadHistory: async () => { calls++; active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return bars; },
    writeCheckpoint: async value => { saved = value; } };
  const service = createMa200Scanner(options);
  await service.start(false, 'cloud'); await service.start(false, 'line-break'); await service.settled();
  assert.equal(calls, 12); assert.ok(maximum <= 2);
  for (const interval of ['day', 'week']) {
    const snapshot = await service.snapshot(interval, 'cloud');
    assert.equal(snapshot.status, 'done'); assert.ok(snapshot.markets.every(m => m.completed === 2));
    assert.ok((await service.snapshot(interval, 'ma200')).markets.every(m => m.completed === 2));
    assert.ok((await service.snapshot(interval, 'line-break')).markets.every(m => m.completed === 2));
    assert.ok((await service.snapshot(interval, 'cloud-candle')).markets.every(m => m.completed === 2));
  }
  saved.version = 3;
  saved.markets.forEach(m => { delete m.rows[0].cloud; });
  const restored = createMa200Scanner({ ...options, readCheckpoint: async () => saved });
  await restored.start(false, 'ma200'); assert.equal(calls, 12);
  assert.equal((await restored.snapshot('day', 'cloud')).status, 'interrupted');
  await restored.start(false, 'cloud'); await restored.settled();
  assert.equal(calls, 20, 'four benchmarks and four missing records only');
  assert.equal((await restored.snapshot('day', 'cloud')).status, 'done');
  await restored.start(false, 'cloud'); assert.equal(calls, 20);
  await restored.start(false, 'cloud-candle'); assert.equal(calls, 20, 'switching candle/MA20 never re-fetches history');
});

test('cloud API validates targets and authenticates both candle and MA20 modes', async () => {
  const calls = [];
  const handler = createCloudScanHandler({ start: async (...args) => calls.push(args), snapshot: async (...args) => ({ args, markets: [] }) }, req => req.headers.password === 'yes', () => false);
  async function request(target, password = 'yes') {
    const res = { code: 200, status(code) { this.code = code; return this; }, setHeader() {}, json(data) { this.data = data; return this; } };
    await handler({ method: 'GET', query: { interval: 'week', target, start: '1' }, headers: { password } }, res); return res;
  }
  assert.equal((await request('candle', 'no')).code, 401);
  assert.equal((await request('__proto__')).code, 400);
  assert.deepEqual((await request('candle')).data.args, ['week', 'cloud-candle']);
  assert.deepEqual((await request('ma20')).data.args, ['week', 'cloud']);
  assert.deepEqual((await request(undefined)).data.args, ['week', 'cloud-candle']);
  assert.deepEqual(calls, [[false, 'cloud-candle'], [false, 'cloud'], [false, 'cloud-candle']]);
});

test('cloud endpoint has the same authentication/interval checks and forwards the indicator', async () => {
  const calls = [];
  const handler = createScanHandler({ start: async (...args) => calls.push(args), snapshot: async (...args) => ({ args, markets: [] }) }, req => req.headers.password === 'yes', () => false, 'cloud');
  async function request(interval, password = 'yes') {
    const res = { code: 200, status(code) { this.code = code; return this; }, setHeader() {}, json(data) { this.data = data; return this; } };
    await handler({ method: 'GET', query: { interval, start: '1' }, headers: { password } }, res); return res;
  }
  assert.equal((await request('day', 'no')).code, 401);
  assert.equal((await request('month')).code, 400);
  assert.deepEqual((await request('week')).data.args, ['week', 'cloud']);
  assert.deepEqual(calls, [[false, 'cloud']]);
});

test('79-week cloud stocks are not excluded by a failed 200-week history supplement', async () => {
  const bars = history(600);
  const scanner = createMa200Scanner({
    loadUniverse: async key => ({ items: [{ symbol: key, name: key }] }),
    loadHistory: async () => bars,
    loadWeeklyHistory: async () => { throw new Error('HTTP 429'); },
  });
  await scanner.start(false, 'cloud'); await scanner.settled();
  const cloud = await scanner.snapshot('week', 'cloud');
  assert.equal(cloud.status, 'done');
  assert.ok(cloud.markets.every(m => m.valid === 1 && m.excludedCount === 0));
  assert.ok((await scanner.snapshot('week', 'ma200')).markets.every(m => m.exclusionCounts.error === 1));
});

test('Korean provider histories retain actual open/high/low, including native weekly supplementation', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => '<chart><item data="20261019|95|130|80|100|12345"/></chart>' });
  try {
    assert.deepEqual((await fetchScanHistory('005930.KS', 'kospi'))[0], { date: '20261019', open: 95, high: 130, low: 80, close: 100 });
    assert.deepEqual((await fetchScanWeeklyHistory('005930.KS', 'kospi'))[0], { time: '2026-10-19', close: 100, open: 95, high: 130, low: 80 });
  } finally { globalThis.fetch = originalFetch; }
});
