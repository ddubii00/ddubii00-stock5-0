import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanStockLabel } from '../src/utils/scanTable.js';

test('scan stock labels allocate at most 15 characters including the ellipsis', () => {
  assert.equal(scanStockLabel('삼성전자'), '삼성전자');
  assert.equal(scanStockLabel('가'.repeat(15)), '가'.repeat(15));
  assert.equal(scanStockLabel('가'.repeat(16)), `${'가'.repeat(14)}…`);
  assert.equal(scanStockLabel('ABCDEFGHIJKLMNOPQRSTUVWXYZ'), 'ABCDEFGHIJKLMN…');
  assert.equal(Array.from(scanStockLabel('📈'.repeat(16))).length, 15);
  assert.equal(scanStockLabel(null), '');
});
