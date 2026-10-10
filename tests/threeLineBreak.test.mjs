import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateThreeLineBreak, threeLineBreak } from '../src/utils/threeLineBreak.js';
import { cleanTrendLines } from '../src/utils/trendLines.js';
import { mainHistoryWindow } from '../src/utils/chartHistory.js';
import { calculateMA, calculateBollingerBands } from '../src/utils/indicators.js';

const bars = closes => closes.map((close, i) => ({ time: 1000 + i * 60,
  open: close - 1, high: close + 20, low: close - 20, close, volume: 10 }));

test('stock5-8 line bodies use closes and strict reversals, not source wicks', () => {
  const result = calculateThreeLineBreak(bars([100, 110, 120, 130, 129, 101, 100, 99, 98]));
  assert.deepEqual(result.map(line => [line.open, line.close]), [[100, 110], [110, 120], [120, 130], [120, 99], [99, 98]]);
  assert.equal(result[3].time, 1000 + 7 * 60);
  assert.equal(result[3].volume, 40);
  assert.equal(result[3].sourceCount, 4);
  assert.equal(result[3].startTime, 1000 + 4 * 60);
  assert.ok(result.every(line => line.high === Math.max(line.open, line.close) && line.low === Math.min(line.open, line.close)));
});

test('downtrend upward reversal and rolling three-line window match stock5-8', () => {
  const down = calculateThreeLineBreak(bars([100, 90, 80, 70, 71, 100, 101]));
  assert.deepEqual(down.map(line => [line.open, line.close]), [[100, 90], [90, 80], [80, 70], [80, 101]]);
  const rolling = calculateThreeLineBreak(bars([100, 110, 120, 130, 140, 111, 110, 109]));
  assert.equal(rolling.at(-1).open, 130);
  assert.equal(rolling.at(-1).close, 109);
  assert.equal(rolling.at(-1).sourceCount, 3);
});

test('flat and empty histories produce no fabricated lines', () => {
  for (const source of [[], bars([100]), bars([100, 100, 100])]) assert.deepEqual(calculateThreeLineBreak(source), []);
});

test('volume counts source bars once and leaves pending or unknown volumes unplotted', () => {
  const source = bars([100, 100, 110, 109, 111, 110]);
  const original = structuredClone(source);
  assert.deepEqual(calculateThreeLineBreak(source).map(line => line.volume), [30, 20]);
  assert.deepEqual(source, original, 'cached original candles and Ichimoku source remain unchanged');
  source[1].volume = null;
  assert.equal(calculateThreeLineBreak(source)[0].volume, null);
  source[1].volume = -1;
  assert.equal(calculateThreeLineBreak(source)[0].volume, null);
});

test('daily, weekly and intraday breakout anchors stay on original times', () => {
  for (const times of [['2026-09-01', '2026-09-08', '2026-09-15'], [123, 456, 789]]) {
    const source = bars([100, 110, 120]).map((bar, i) => ({ ...bar, time: times[i] }));
    assert.deepEqual(calculateThreeLineBreak(source).map(line => line.time), times.slice(1));
  }
});

test('scanner signals and drawn lines use one calculation and exact reversal dates', () => {
  const source = bars([100, 110, 120, 130, 99, 98, 97, 121, 122]);
  const events = threeLineBreak(source);
  const drawn = calculateThreeLineBreak(source);
  assert.deepEqual(events.filter(row => row.generated).map(row => row.line), drawn);
  for (const event of events.filter(row => row.signal)) {
    const line = drawn.find(row => row.time === event.time);
    assert.ok(line);
    assert.equal(line.close > line.open, event.signal === 'bullish');
  }
});

test('MA200 and BB use generated-line warmup while restoring the source leaves every OHLC unchanged', () => {
  const source = bars(Array.from({ length: 500 }, (_, i) => 100 + i));
  const before = structuredClone(source);
  const generated = calculateThreeLineBreak(source);
  const display = mainHistoryWindow(generated, 120);
  const ma = calculateMA(generated, 200).slice(display.start);
  const bb = calculateBollingerBands(generated).slice(display.start);
  assert.equal(display.missingVisibleMA200, 0);
  assert.deepEqual(display.candles.map(row => row.time), ma.map(row => row.time));
  assert.deepEqual(display.candles.map(row => row.time), bb.map(row => row.time));
  assert.ok(ma.every(row => Number.isFinite(row.value)));
  assert.deepEqual(source, before);
  assert.deepEqual(mainHistoryWindow(source, 120).candles, mainHistoryWindow(before, 120).candles);
});

test('line-break trend drawings are isolated and survive alongside normal timeframe drawings', () => {
  const line = { id: 'test', start: { time: 1790640000, price: 100 }, end: { time: 1790726400, price: 110 }, width: 1 };
  const saved = cleanTrendLines({ 'TEST:day': [line], 'TEST:day:line-break': [line], 'TEST:week:line-break': [line], 'TEST:day:invalid': [line] });
  assert.equal(saved['TEST:day'].length, 1);
  assert.equal(saved['TEST:day:line-break'].length, 1);
  assert.equal(saved['TEST:week:line-break'].length, 1);
  assert.equal(saved['TEST:day:invalid'], undefined);
});
