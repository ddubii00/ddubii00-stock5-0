import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FINANCIAL_SORT_COLUMNS, financialSortValue, sortFinancialRows, loadFinancialSortRecords } from '../src/utils/financialSort.js';
import { activeCommonConditions, validateCommonConditions } from '../src/utils/commonScan.js';
import { stocksInPositionGroup } from '../src/utils/positionGroups.js';

test('every financial field sorts raw numeric values globally, not rounded display text, with stable ties', () => {
  for (const { key } of FINANCIAL_SORT_COLUMNS) {
    const rows = ['ten', 'two', 'negative', 'zero', 'missing', 'failed', 'twin', 'round-a', 'round-b'].map(symbol => ({ symbol }));
    const records = Object.fromEntries(rows.map(({ symbol }) => [symbol, { data: { [key]: {
      ten: 10, two: 2, negative: -3, zero: 0, missing: null, twin: 2, 'round-a': 2.001, 'round-b': 2.0001,
    }[symbol] } }]));
    records.failed = { data: null, error: 'synthetic failure' };
    const ascending = sortFinancialRows(rows, records, { key, direction: 'asc' });
    assert.deepEqual(ascending.map(r => r.symbol), ['negative', 'zero', 'two', 'twin', 'round-b', 'round-a', 'ten', 'missing', 'failed'], key);
    assert.deepEqual(sortFinancialRows(rows, records, { key, direction: 'desc' }).map(r => r.symbol),
      ['ten', 'round-a', 'round-b', 'two', 'twin', 'zero', 'negative', 'missing', 'failed'], key);
    assert.equal(rows[0].symbol, 'ten', 'never mutate provider order');
  }
});

test('missing, forward-only PER, zero and negative financials match the displayed metrics', () => {
  assert.equal(financialSortValue({ pe: 17, peForward: true }, 'pe'), null);
  assert.equal(financialSortValue({ forwardPe: 17 }, 'forwardPe'), 17);
  assert.equal(financialSortValue({ roe: 0 }, 'roe'), 0);
  assert.equal(financialSortValue({ operatingIncome: -1e12 }, 'operatingIncome'), -1e12);
  for (const value of [null, undefined, NaN, Infinity, '17.07']) assert.equal(financialSortValue({ pe: value }, 'pe'), null);
  const rows = [{ symbol: 'A' }]; assert.equal(sortFinancialRows(rows, {}, null), rows);
});

test('sorting includes off-page results, not just the first 100', () => {
  const rows = Array.from({ length: 205 }, (_, i) => ({ symbol: `STOCK${i}` }));
  const records = Object.fromEntries(rows.map((r, i) => [r.symbol, { data: { pe: 205 - i } }]));
  const sorted = sortFinancialRows(rows, records, { key: 'pe', direction: 'asc' });
  assert.equal(sorted[0].symbol, 'STOCK204'); assert.equal(sorted[100].symbol, 'STOCK104'); assert.equal(sorted.length, 205);
});

test('full-result loading deduplicates symbols, limits workers to two, exposes failures and cancellation', async () => {
  let active = 0, maximum = 0, calls = 0, final;
  const symbols = ['A', 'A', 'B', 'C', 'D'];
  const result = await loadFinancialSortRecords(symbols, async symbol => {
    calls++; active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    if (symbol === 'D') throw new Error('synthetic missing');
    return { data: { pe: 17.07 }, error: '' };
  }, { onProgress: progress => { final = progress; } });
  assert.equal(calls, 4); assert.ok(maximum <= 2); assert.equal(result.completed, 4); assert.equal(result.failures, 1);
  assert.equal(final.completed, 4); assert.match(final.records.D.error, /synthetic/);
  let stopped = false, cancelledCalls = 0;
  await loadFinancialSortRecords(Array.from({ length: 100 }, (_, i) => String(i)), async () => {
    cancelledCalls++; await new Promise(resolve => setTimeout(resolve, 1)); stopped = true; return { data: {}, error: '' };
  }, { stopped: () => stopped });
  assert.ok(cancelledCalls <= 2, 'changing a filter never queues all remaining old stocks');
});

test('optional third condition is omitted with - and restores the original two-condition query', () => {
  const first = { kind: 'line-break', interval: 'day', direction: 'breakout' };
  const second = { kind: 'cloud', interval: 'week', direction: 'breakout', target: 'ma20' };
  assert.equal(validateCommonConditions(activeCommonConditions([first, second, { kind: '' }])).length, 2);
  assert.equal(activeCommonConditions([first, second, { kind: '-' }]).length, 2);
  const third = { kind: 'ma-cross', interval: 'day', direction: 'breakout', pair: '5-20' };
  assert.equal(validateCommonConditions(activeCommonConditions([first, second, third])).length, 3);
});

test('saved-stock groups preserve membership and sort within each category, including flags only', () => {
  const rows = [{ symbol: 'A', status: 'long-hold' }, { symbol: 'B', status: 'long-watch' },
    { symbol: 'C', status: 'long-hold' }, { symbol: 'D', status: '', ready: true }, { symbol: 'E', status: '', caution: true }];
  const records = Object.fromEntries(rows.map((r, i) => [r.symbol, { data: { pe: 10 - i } }]));
  const sorted = sortFinancialRows(rows, records, { key: 'pe', direction: 'asc' });
  assert.deepEqual(stocksInPositionGroup(sorted, 'long-hold').map(r => r.symbol), ['C', 'A']);
  assert.deepEqual(stocksInPositionGroup(sorted, 'long-watch').map(r => r.symbol), ['B']);
  assert.deepEqual(stocksInPositionGroup(sorted, '').map(r => r.symbol), ['E', 'D']);
});
