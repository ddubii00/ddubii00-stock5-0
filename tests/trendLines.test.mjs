import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candleTimestamp, cleanTrendLines, distanceToTrendLine, logicalAtTime, timeAtLogical } from '../src/utils/trendLines.js';

test('saved anchors stay on trading dates as the loaded history changes', () => {
  const bars = ['2026-09-28', '2026-09-29', '2026-09-30'].map(time => ({ time }));
  const time = timeAtLogical(bars, 1);
  assert.equal(time, candleTimestamp('2026-09-29'));
  assert.equal(logicalAtTime(bars, time), 1);
  assert.equal(logicalAtTime([{ time: '2026-09-25' }, ...bars], time), 2);
  assert.equal(logicalAtTime(bars.slice(1), time), 0);
  assert.equal(logicalAtTime(bars.slice(2), time), null);
});

test('line hit testing leaves ordinary chart pointer events untouched', () => {
  const line = { a: { x: 10, y: 20 }, b: { x: 110, y: 20 } };
  assert.equal(distanceToTrendLine({ x: 50, y: 25 }, line), 5);
  assert.equal(distanceToTrendLine({ x: 120, y: 20 }, line), 10);
  assert.equal(distanceToTrendLine({ x: 50, y: 25 }, { a: { x: null, y: 20 }, b: line.b }), Infinity);
});

test('saved drawings are isolated by symbol and timeframe and reject invalid anchors', () => {
  const line = { id: 'line', start: { time: 1790640000, price: 100 }, end: { time: 1790726400, price: 120 }, width: 2 };
  const saved = cleanTrendLines({
    'NVDA:day': [line, { ...line, end: { time: 'bad', price: 10 } }],
    'NVDA:week': [{ ...line, width: 3 }],
    invalid: [line],
  });
  assert.deepEqual(saved['NVDA:day'], [line]);
  assert.equal(saved['NVDA:week'][0].width, 3);
  assert.equal(saved.invalid, undefined);
});
