import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKoreanWeeklyLoader, fetchKoreanWeeklyOhlcv } from '../api/_koreanWeekly.js';
import { fetchKoreanOhlcv } from '../api/_shared.js';
import { analyzeCloudHistory } from '../src/utils/cloudScan.js';
import { scanReference } from '../src/utils/ma200Scan.js';
import { calculateIchimoku, calculateMA } from '../src/utils/indicators.js';

test('weekly charts share one Naver request across candle/Ichimoku limits and refresh after 15 seconds', async () => {
  let calls = 0, clock = 0;
  const xml = '<item data="20261023|181500|195600|180200|183800|42"/><item data="20261030|184200|186300|177000|184600|43"/>';
  const load = createKoreanWeeklyLoader({ now: () => clock, fetchImpl: async url => {
    calls++;
    const params = new URL(url).searchParams;
    assert.equal(params.get('symbol'), '005830'); assert.equal(params.get('timeframe'), 'week');
    return { ok: true, text: async () => xml };
  } });
  const [main, ichi] = await Promise.all([load('005830.KS', 840), load('005830', 600)]);
  assert.equal(calls, 1); assert.deepEqual(main, ichi);
  assert.deepEqual(main.at(-1), { time: '2026-10-30', open: 184200, high: 186300, low: 177000, close: 184600, volume: 43 });
  assert.equal(main.length, 2, 'no extra daily quote appended as a third weekly candle');
  clock = 14999; assert.equal((await load('005830', 1)).length, 1); assert.equal(calls, 1);
  clock = 15000; await load('005830', 600); assert.equal(calls, 2);
});

test('weekly chart failures retry, never fall back silently to incompatible weekly candles', async () => {
  let calls = 0;
  const load = createKoreanWeeklyLoader({ fetchImpl: async () => {
    calls++; if (calls === 1) return { ok: false, status: 503 };
    return { ok: true, text: async () => '<item data="20261030|184200|186300|177000|184600|43"/>' };
  } });
  await assert.rejects(load('005830', 120), /503/);
  assert.equal((await load('005830', 120)).length, 1); assert.equal(calls, 2);
  await assert.rejects(load('NVDA', 120), /종목코드/);
  const empty = createKoreanWeeklyLoader({ fetchImpl: async () => ({ ok: true, text: async () => '<chart/>' }) });
  await assert.rejects(empty('005830', 120), /비어/);
});

test('weekly chart and scan agree; two SMA20 points still inside a nonzero cloud never qualify', async () => {
  const bars = Array.from({ length: 79 }, (_, i) => ({
    time: new Date(Date.parse('2025-05-02T00:00:00Z') + i * 7 * 86400000).toISOString().slice(0, 10),
    open: 145000, high: 160000, low: i < 26 ? 100000 : 140000, close: 145000,
  }));
  const xml = bars.map(b => `<item data="${b.time.replaceAll('-', '')}|${b.open}|${b.high}|${b.low}|${b.close}|1"/>`).join('');
  const load = createKoreanWeeklyLoader({ fetchImpl: async () => ({ ok: true, text: async () => xml }) });
  const weekly = await load('005830', 120), cloud = calculateIchimoku(weekly), ma = calculateMA(weekly, 20);
  const result = analyzeCloudHistory(bars, scanReference(bars), weekly).week;
  assert.equal(result.status, 'ready'); assert.equal(result.signal, null);
  assert.ok(result.previous.cloudLow < result.previous.ma20 && result.previous.ma20 < result.previous.cloudHigh);
  assert.ok(result.latest.cloudLow < result.latest.ma20 && result.latest.ma20 < result.latest.cloudHigh);
  for (const offset of [-2, -1]) {
    const point = offset === -2 ? result.previous : result.latest;
    assert.equal(point.ma20, ma.at(offset).value);
    assert.equal(point.spanA, cloud.at(offset).senkouA); assert.equal(point.spanB, cloud.at(offset).senkouB);
  }
});

test('serverless domestic weekly route delegates to the shared loader, not Yahoo', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.match(String(url), /fchart\.stock\.naver\.com/);
    return { ok: true, text: async () => '<item data="20261030|100|110|90|105|4"/>' };
  };
  try {
    // The default loader resolves fetch at invocation, including in serverless.
    assert.equal(typeof fetchKoreanWeeklyOhlcv, 'function');
    const rows = await fetchKoreanOhlcv('999999.KQ', 'week', 10);
    assert.equal(rows[0].close, 105);
  } finally { globalThis.fetch = original; }
});
