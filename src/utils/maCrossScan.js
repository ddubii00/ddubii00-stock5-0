import { calculateMA } from './indicators.js';
import { scanPeriods } from './ma200Scan.js';

export const MA_CROSS_PAIRS = { '5-20': [5, 20], '5-60': [5, 60], '20-60': [20, 60] };

// A touch today is not yet a cross. Yesterday may be on the boundary.
export function maCrossDirection(previousFast, previousSlow, latestFast, latestSlow) {
  if (![previousFast, previousSlow, latestFast, latestSlow].every(Number.isFinite)) return null;
  if (previousFast <= previousSlow && latestFast > latestSlow) return 'breakout';
  if (previousFast >= previousSlow && latestFast < latestSlow) return 'breakdown';
  return null;
}

function compare(bars, reference, interval, fast, slow) {
  if (bars.length < slow + 1) return { status: 'short-history', available: bars.length, required: slow + 1 };
  const previous = bars.at(-2), latest = bars.at(-1);
  if (previous.time !== reference.previous || latest.time !== reference.latest
    || (interval === 'week' && (previous.lastDate !== reference.previousDate || latest.lastDate !== reference.latestDate))) {
    return { status: 'stale', latestDate: latest.lastDate || latest.time };
  }
  const window = bars.slice(-slow - 1), a = calculateMA(window, fast), b = calculateMA(window, slow);
  const point = (bar, offset) => ({ date: bar.lastDate || bar.time, close: bar.close, fastMA: a.at(offset).value, slowMA: b.at(offset).value });
  const before = point(previous, -2), current = point(latest, -1);
  return { status: 'ready', signal: maCrossDirection(before.fastMA, before.slowMA, current.fastMA, current.slowMA),
    previous: before, latest: current, fast, slow, distancePct: (current.fastMA / current.slowMA - 1) * 100 };
}

export function analyzeMaCrossHistory(history, reference, weeklyHistory = null) {
  const { daily, weekly } = scanPeriods(history, reference, weeklyHistory);
  return Object.fromEntries([['day', daily], ['week', weekly]].map(([interval, bars]) => [interval,
    Object.fromEntries(Object.entries(MA_CROSS_PAIRS).map(([key, [fast, slow]]) => [key, compare(bars, reference[interval], interval, fast, slow)]))]));
}
