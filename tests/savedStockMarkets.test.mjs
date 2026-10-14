import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAVED_STOCK_MARKETS, savedStockMarket, filterSavedStocks } from '../src/utils/savedStockMarkets.js';

test('saved symbols identify Korean/Japanese markets without guessing unverified US exchanges', () => {
  for (const [symbol, market] of [['005930.KS', 'kospi'], ['247540.KQ', 'kosdaq'],
    [' nvda ', 'us'], ['BRK-B', 'us'], ['BRK.B', 'us'], ['7203.T', 'japan'], ['130A.T', 'japan'],
    ['005930', 'other'], ['^KS11', 'other'], ['KRW=X', 'other'], ['RY.TO', 'other'], ['0700.HK', 'other'], [null, 'other']]) {
    assert.equal(savedStockMarket(symbol), market, String(symbol));
  }
  assert.deepEqual(SAVED_STOCK_MARKETS.map(([key]) => key), ['kospi', 'kosdaq', 'us', 'japan', 'other']);
});

test('market and name/code filters intersect across all record groups, preserve flags and never mutate records', () => {
  const positions = {
    '005930.KS': { symbol: '005930.KS', name: '삼성전자', status: 'long-hold', ready: true, caution: true },
    '247540.KQ': { symbol: '247540.KQ', name: '에코프로비엠', status: 'short-watch' },
    NVDA: { symbol: 'NVDA', name: '엔비디아', status: 'long-watch' },
    '7203.T': { symbol: '7203.T', name: '도요타', status: 'short-hold' },
    '005930': { symbol: '005930', name: '옛 기록', status: '', ready: true },
  };
  const before = JSON.stringify(positions);
  assert.equal(filterSavedStocks(positions).length, 5);
  assert.deepEqual(filterSavedStocks(positions, 'kospi', ' 삼성 ').map(row => row.symbol), ['005930.KS']);
  assert.equal(filterSavedStocks(positions, 'kosdaq', '삼성').length, 0);
  assert.deepEqual(filterSavedStocks(positions, 'us', ' nvDa ').map(row => row.symbol), ['NVDA']);
  assert.deepEqual(filterSavedStocks(positions, 'japan', '7203').map(row => row.symbol), ['7203.T']);
  assert.equal(filterSavedStocks(positions, 'other')[0].ready, true);
  assert.equal(filterSavedStocks(positions, 'kospi')[0], positions['005930.KS']);
  assert.equal(JSON.stringify(positions), before);
  assert.deepEqual(filterSavedStocks({}, 'all'), []);
});
