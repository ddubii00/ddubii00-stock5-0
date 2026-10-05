import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mainHistoryRequestLimit, mainHistoryWindow, MAX_OHLCV_HISTORY } from '../src/utils/chartHistory.js';
import { calculateMA, calculateMACD, calculateBollingerBands } from '../src/utils/indicators.js';

const bars = length => Array.from({ length }, (_, i) => ({
  time: i + 1, open: i + 1, high: i + 2, low: i, close: i + 1, volume: 100 + i,
}));

test('MA200 covers every plotted bar, including the left edge when panning into history', () => {
  for (const interval of ['day', 'week', 'month', '1m', '60m']) {
    for (const visibleBars of [10, 120, 500, 1000, 2000]) {
      const history = bars(mainHistoryRequestLimit(interval, visibleBars));
      const { candles, start, missingVisibleMA200 } = mainHistoryWindow(history, visibleBars);
      const ma = calculateMA(history, 200).slice(start);
      assert.equal(start, 199);
      assert.equal(missingVisibleMA200, 0);
      assert.ok(candles.length >= visibleBars);
      assert.deepEqual(ma.map(d => d.time), candles.map(d => d.time));
      assert.ok(ma.every(d => Number.isFinite(d.value)));
      assert.deepEqual(ma[0], { time: 200, value: 100.5 });
      assert.equal(ma.at(-1).value, history.length - 99.5);
    }
  }
});

test('short provider history preserves candles and accurately reports uncalculable MA200 bars', () => {
  for (const [length, expectedStart, expectedMissing] of [[120, 0, 120], [250, 130, 69], [319, 199, 0]]) {
    const history = bars(length);
    const { start, candles, missingVisibleMA200 } = mainHistoryWindow(history, 120);
    const ma = calculateMA(history, 200).slice(start);
    assert.equal(start, expectedStart);
    assert.equal(candles.length, 120);
    assert.equal(missingVisibleMA200, expectedMissing);
    assert.equal(ma.filter(d => d.value === null).length, expectedMissing);
    assert.deepEqual(candles.at(-1), history.at(-1));
  }
  assert.deepEqual(mainHistoryWindow([], 120), { start: 0, candles: [], missingVisibleMA200: 0 });
});

test('all indicators retain real warm-up history and share the plotted candle timeline', () => {
  const history = bars(840);
  const { start, candles } = mainHistoryWindow(history, 120);
  const times = candles.map(d => d.time);
  const series = [
    ...[5, 10, 20, 60, 120, 200].map(period => calculateMA(history, period)),
    calculateBollingerBands(history), calculateMACD(history),
  ];
  series.forEach(data => assert.deepEqual(data.slice(start).map(d => d.time), times));
  assert.equal(calculateMA(history, 5).slice(start)[0].value, 198);
  assert.equal(calculateBollingerBands(history).slice(start)[0].middle, 190.5);
});

test('history limits allow 2000 displayed bars plus MA200 warm-up without increasing ordinary requests', () => {
  assert.equal(mainHistoryRequestLimit('day', 120), 840);
  assert.equal(mainHistoryRequestLimit('1m', 120), 1320);
  assert.equal(mainHistoryRequestLimit('day', 2000), MAX_OHLCV_HISTORY);
  assert.ok(MAX_OHLCV_HISTORY >= 2000 + 199);
});
