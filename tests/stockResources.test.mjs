import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockResource } from '../src/state/stockResources.js';

test('list/chart resources deduplicate requests, limit concurrency, validate symbols and cache successes/errors separately', async () => {
  const originalFetch = globalThis.fetch, originalStorage = globalThis.localStorage, originalNow = Date.now;
  let clock = 100000, active = 0, maxActive = 0, calls = 0;
  globalThis.localStorage = { getItem: () => 'synthetic-test-only' };
  Date.now = () => clock;
  globalThis.fetch = async (url, options) => {
    calls += 1; active += 1; maxActive = Math.max(active, maxActive);
    assert.equal(options.headers['x-stock5-password'], 'synthetic-test-only');
    await new Promise(resolve => setTimeout(resolve, 5)); active -= 1;
    const symbol = new URL(url, 'https://test.invalid').searchParams.get('symbol');
    return { ok: true, json: async () => ({ symbol: symbol === 'BAD' ? 'OTHER' : symbol, pe: 7.52 }) };
  };
  try {
    const results = await Promise.all(['NVDA', 'NVDA', 'AAPL', 'MSFT', '7203.T'].map(symbol => stockResource('fundamentals', symbol)));
    assert.equal(calls, 4); assert.ok(maxActive <= 2);
    assert.ok(results.every(result => result.data.pe === 7.52));
    await stockResource('fundamentals', 'NVDA'); assert.equal(calls, 4);
    const bad = await stockResource('fundamentals', 'BAD'); assert.match(bad.error, /일치/);
    await stockResource('fundamentals', 'BAD'); assert.equal(calls, 5);
    clock += 30000;
    await stockResource('fundamentals', 'BAD'); assert.equal(calls, 6);
    await stockResource('fundamentals', 'NVDA'); assert.equal(calls, 6);
    clock += 6 * 3600000;
    await stockResource('fundamentals', 'NVDA'); assert.equal(calls, 7);
  } finally {
    globalThis.fetch = originalFetch; Date.now = originalNow;
    if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage;
  }
});
