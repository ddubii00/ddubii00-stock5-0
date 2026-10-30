import assert from 'node:assert/strict';
import { test } from 'node:test';
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
  assert.deepEqual((await request(undefined)).data.args, ['week', 'cloud']);
  assert.deepEqual(calls, [[false, 'cloud-candle'], [false, 'cloud'], [false, 'cloud']]);
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
