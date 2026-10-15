import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSITION_GROUPS, stocksInPositionGroup } from '../src/utils/positionGroups.js';

test('flag-only list requires ready or caution and strictly excludes every long/short status', () => {
  const stocks = [
    { symbol: 'READY', ready: true, status: '' },
    { symbol: 'CAUTION', caution: true },
    { symbol: 'BOTH', ready: true, caution: true, status: '' },
    { symbol: 'AVERAGE', averagePrice: 123, status: '' },
    { symbol: 'EMPTY', ready: false, caution: false },
    ...POSITION_GROUPS.map(([status]) => ({ symbol: status, status, ready: true, caution: true })),
  ];
  const original = JSON.stringify(stocks);
  assert.deepEqual(stocksInPositionGroup(stocks, '').map(row => row.symbol), ['READY', 'CAUTION', 'BOTH']);
  for (const [status] of POSITION_GROUPS) assert.deepEqual(stocksInPositionGroup(stocks, status).map(row => row.symbol), [status]);
  assert.deepEqual(stocksInPositionGroup([], ''), []);
  assert.equal(JSON.stringify(stocks), original);
});
