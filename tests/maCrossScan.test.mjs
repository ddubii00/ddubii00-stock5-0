import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeMaCrossHistory, maCrossDirection, MA_CROSS_PAIRS } from '../src/utils/maCrossScan.js';
import { calculateMA } from '../src/utils/indicators.js';
import { scanReference } from '../src/utils/ma200Scan.js';
import { createMa200Scanner } from '../api/_ma200Scanner.js';
import { createMaCrossScanHandler } from '../api/ma-cross-scan.js';

function history(count = 1250, weekly = false, direction = 'up') {
  const date = new Date('2021-01-04T00:00:00Z');
  return Array.from({ length: count }, (_, i) => {
    if (i) date.setUTCDate(date.getUTCDate() + (weekly ? 7 : 1));
    while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
    const close = i === count - 1 ? direction === 'up' ? 200 : 50 : 100;
    return { time: date.toISOString().slice(0, 10), close, high: Math.max(110, close), low: Math.min(90, close) };
  });
}

test('all three pairs use their own previous/current SMA on daily and weekly bars', () => {
  for (const weekly of [false, true]) for (const direction of ['up', 'down']) {
    const bars = history(weekly ? 61 : 1250, weekly, direction), ref = scanReference(bars);
    const result = analyzeMaCrossHistory(bars, ref)[weekly ? 'week' : 'day'];
    for (const [pair, [fast, slow]] of Object.entries(MA_CROSS_PAIRS)) {
      assert.equal(result[pair].status, 'ready');
      assert.equal(result[pair].signal, direction === 'up' ? 'breakout' : 'breakdown');
      assert.equal(result[pair].latest.date, bars.at(-1).time);
      if (!weekly) {
        assert.equal(result[pair].previous.fastMA, calculateMA(bars, fast).at(-2).value);
        assert.equal(result[pair].latest.slowMA, calculateMA(bars, slow).at(-1).value);
      }
    }
  }
});

test('touches, persistent trends, missing inputs and short/stale history do not invent crosses', () => {
  assert.equal(maCrossDirection(99, 100, 101, 100), 'breakout');
  assert.equal(maCrossDirection(101, 100, 99, 100), 'breakdown');
  assert.equal(maCrossDirection(100, 100, 101, 100), 'breakout');
  assert.equal(maCrossDirection(99, 100, 100, 100), null);
  assert.equal(maCrossDirection(101, 100, 102, 100), null);
  assert.equal(maCrossDirection(null, 100, 101, 100), null);
  const bars = history(61), ref = scanReference(bars);
  assert.equal(analyzeMaCrossHistory(bars.slice(-21), ref).day['5-20'].status, 'ready');
  assert.equal(analyzeMaCrossHistory(bars.slice(-21), ref).day['5-60'].required, 61);
  assert.equal(analyzeMaCrossHistory(history(100).slice(0, -1), scanReference(history(100))).day['20-60'].status, 'stale');
  const future = [...bars, { time: '2040-01-01', close: 99999 }];
  assert.deepEqual(analyzeMaCrossHistory(future, ref), analyzeMaCrossHistory(bars, ref));
});

test('one bounded job computes all pairs/timeframes and lazily backfills only missing v5 cross rows', async () => {
  let saved, calls = 0, active = 0, maximum = 0;
  const bars = history(), clock = () => Date.parse('2026-10-31T00:00:00Z');
  const options = { now: clock, loadUniverse: async key => ({ items: [0, 1].map(i => ({ symbol: `${key}${i}`, name: `${key}${i}` })) }),
    loadHistory: async () => { calls++; active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return bars; },
    writeCheckpoint: async data => { saved = data; } };
  const service = createMa200Scanner(options);
  await service.start(false, 'ma-cross-5-20'); await service.settled();
  assert.ok(maximum <= 2); assert.equal(calls, 12); assert.equal(saved.version, 6);
  for (const pair of Object.keys(MA_CROSS_PAIRS)) {
    const bundle = await service.snapshots(`ma-cross-${pair}`);
    assert.equal(bundle.day.updatedAt, bundle.week.updatedAt);
    assert.ok(bundle.day.markets.every(m => m.valid === 2));
    await service.start(false, `ma-cross-${pair}`);
  }
  assert.equal(calls, 12, 'switching pair or timeframe must not fetch history');
  saved.version = 5;
  saved.markets.forEach(m => { delete m.rows[0].maCross; });
  const restored = createMa200Scanner({ ...options, readCheckpoint: async () => saved });
  assert.equal((await restored.snapshot('day', 'ma-cross-5-20')).status, 'interrupted');
  assert.ok((await restored.snapshot('day', 'line-break')).markets.every(m => m.completed === 2));
  await restored.start(false, 'common'); await restored.settled();
  assert.equal(calls, 20, 'four benchmarks plus just four missing stocks');
  assert.equal((await restored.snapshot('week', 'ma-cross-20-60')).status, 'done');
});

test('weekly crosses can be valid despite insufficient MA200 history and a failed weekly supplement', async () => {
  const bars = history(61, true);
  const scanner = createMa200Scanner({ loadUniverse: async key => ({ items: [{ symbol: key, name: key }] }), loadHistory: async () => bars,
    loadWeeklyHistory: async () => { throw new Error('test weekly source failure'); } });
  await scanner.start(false, 'ma-cross-5-60'); await scanner.settled();
  assert.ok((await scanner.snapshot('week', 'ma-cross-5-60')).markets.every(m => m.valid === 1));
  assert.ok((await scanner.snapshot('week', 'ma200')).markets.every(m => m.exclusionCounts.error === 1));
});

test('cross API validates pair/auth/timeframe and returns one day/week bundle', async () => {
  const calls = [], service = { start: async (...args) => calls.push(args), snapshots: async indicator => ({ indicator, day: { markets: [] }, week: { markets: [] } }) };
  const handler = createMaCrossScanHandler(service, req => req.headers.password === 'yes', () => false);
  async function request(query, password = 'yes') {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, setHeader() {}, json(data) { this.data = data; return this; } };
    await handler({ method: 'GET', headers: { password }, query: { interval: 'both', start: '1', ...query } }, res); return res;
  }
  assert.equal((await request({}, 'no')).statusCode, 401);
  assert.equal((await request({ pair: '5-200' })).statusCode, 400);
  assert.equal((await request({ interval: 'month' })).statusCode, 400);
  assert.equal((await request({ pair: '20-60' })).data.indicator, 'ma-cross-20-60');
  assert.deepEqual(calls, [[false, 'ma-cross-20-60']]);
});

test('a failed weekly supplement is reported as a provider error, not falsely as insufficient listing history', async () => {
  const bars = history(22, true);
  const scanner = createMa200Scanner({ loadUniverse: async key => ({ items: [{ symbol: key, name: key }] }), loadHistory: async () => bars,
    loadWeeklyHistory: async () => { throw new Error('synthetic network error'); } });
  await scanner.start(false, 'ma-cross-5-60'); await scanner.settled();
  const result = await scanner.snapshot('week', 'ma-cross-5-60');
  assert.ok(result.markets.every(m => m.exclusionCounts.error === 1 && /추가 조회 실패/.test(m.excluded[0].error)));
  assert.ok((await scanner.snapshot('week', 'ma-cross-5-20')).markets.every(m => m.valid === 1));
});
