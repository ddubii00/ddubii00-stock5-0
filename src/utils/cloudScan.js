import { calculateIchimoku, calculateMA } from './indicators.js';
import { normalizeDailyHistory, weeklyCloses } from './ma200Scan.js';

export const CLOUD_REQUIRED_BARS = 79; // 52 + 26 displacement + two comparable bars.

export function cloudCrossing(previousMA, previousLow, previousHigh, latestMA, latestLow, latestHigh) {
  if (![previousMA, previousLow, previousHigh, latestMA, latestLow, latestHigh].every(Number.isFinite)) return null;
  if (previousMA < previousLow || previousMA > previousHigh) return null;
  if (latestMA > latestHigh) return 'breakout';
  if (latestMA < latestLow) return 'breakdown';
  return null; // Touching an edge is still inside; cloud colour is irrelevant.
}

// Candles use the actual close, not high/low wick touches. Both targets reuse
// the same displaced cloud and reference periods, without provider requests.
export function cloudResultForTarget(result, target = 'ma20') {
  if (target !== 'candle' || result?.status !== 'ready') return result;
  const { previous, latest } = result;
  const signal = cloudCrossing(previous.close, previous.cloudLow, previous.cloudHigh,
    latest.close, latest.cloudLow, latest.cloudHigh);
  const boundary = signal === 'breakdown' ? latest.cloudLow : latest.cloudHigh;
  return { ...result, signal, distancePct: (latest.close / boundary - 1) * 100 };
}

function candles(history) {
  const result = normalizeDailyHistory(history);
  if (result.some(bar => !Number.isFinite(bar.high) || !Number.isFinite(bar.low)
    || bar.low <= 0 || bar.high < bar.low || bar.close < bar.low || bar.close > bar.high)) {
    throw new Error('구름 계산에 필요한 실제 고가·저가 자료가 없거나 잘못되었습니다.');
  }
  return result;
}

export function weeklyCloudBars(daily) {
  const weeks = new Map();
  for (const bar of daily) {
    const time = weeklyCloses([bar])[0].time;
    const previous = weeks.get(time);
    weeks.set(time, { time, high: Math.max(previous?.high ?? -Infinity, bar.high),
      low: Math.min(previous?.low ?? Infinity, bar.low), close: bar.close, lastDate: bar.time });
  }
  return [...weeks.values()];
}

function compare(bars, reference, interval) {
  if (bars.length < CLOUD_REQUIRED_BARS) return { status: 'short-history', available: bars.length, required: CLOUD_REQUIRED_BARS };
  const previous = bars.at(-2), latest = bars.at(-1);
  if (previous.time !== reference.previous || latest.time !== reference.latest
    || (interval === 'week' && (previous.lastDate !== reference.previousDate || latest.lastDate !== reference.latestDate))) {
    return { status: 'stale', latestDate: latest.lastDate || latest.time };
  }
  // Both current cloud values and both SMA20 values depend on only 79 bars.
  bars = bars.slice(-CLOUD_REQUIRED_BARS);
  const cloud = calculateIchimoku(bars), averages = calculateMA(bars, 20);
  const point = index => {
    const { senkouA, senkouB } = cloud[index];
    return { date: bars[index].lastDate || bars[index].time, close: bars[index].close,
      ma20: averages[index].value, spanA: senkouA, spanB: senkouB,
      cloudLow: Math.min(senkouA, senkouB), cloudHigh: Math.max(senkouA, senkouB),
      cloudType: senkouA > senkouB ? 'positive' : senkouA < senkouB ? 'negative' : 'flat' };
  };
  const before = point(bars.length - 2), current = point(bars.length - 1);
  const signal = cloudCrossing(before.ma20, before.cloudLow, before.cloudHigh, current.ma20, current.cloudLow, current.cloudHigh);
  const boundary = signal === 'breakdown' ? current.cloudLow : current.cloudHigh;
  return { status: 'ready', signal, previous: before, latest: current, distancePct: (current.ma20 / boundary - 1) * 100 };
}

export function analyzeCloudHistory(history, reference, weeklyHistory = null) {
  let daily;
  try { daily = candles(history).filter(bar => bar.time <= reference.day.latest); }
  catch (error) { const failed = { status: 'error', error: error.message }; return { day: failed, week: failed }; }
  const day = compare(daily, reference.day, 'day');
  try {
    let weeks = weeklyCloudBars(daily);
    const native = weeklyHistory ? weeklyCloudBars(candles(weeklyHistory)).filter(bar => bar.time <= reference.week.latest) : [];
    // Do not let an initial partial daily week replace a full native range.
    // Recent weeks use the daily snapshot only, including actual trading dates.
    if (weeks.length > 1 && daily[0].time > weeks[0].time) {
      const complete = native.find(bar => bar.time === weeks[0].time);
      if (complete) weeks[0] = { ...complete, close: weeks[0].close, lastDate: weeks[0].lastDate };
      else weeks = weeks.slice(1);
    }
    const first = weeks[0]?.time || reference.week.latest;
    weeks = [...native.filter(bar => bar.time < first), ...weeks];
    const week = compare(weeks, reference.week, 'week');
    if (weeklyHistory) week.supplemented = true;
    return { day, week };
  } catch (error) { return { day, week: { status: 'error', error: error.message } }; }
}
