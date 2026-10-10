import { scanPeriods } from './ma200Scan.js';
import { threeLineBreak } from './threeLineBreak.js';
export { threeLineBreak } from './threeLineBreak.js';

// Three-line break uses generated lines, not the latest three calendar bars.
// Continuations extend the last line; reversals must strictly break the range
// of the last three lines. Equality and moves inside the range add no line.
// https://www.tradingview.com/support/solutions/43000502273-introduction-to-line-break-charts/
function analyzeBars(bars, reference, interval) {
  if (bars.length < 2) return { status: 'short-history', available: bars.length, availableLines: 0, requiredLines: 3 };
  const previous = bars.at(-2), latest = bars.at(-1);
  if (previous.time !== reference.previous || latest.time !== reference.latest
    || (interval === 'week' && (previous.lastDate !== reference.previousDate || latest.lastDate !== reference.latestDate))) {
    return { status: 'stale', latestDate: latest.lastDate || latest.time };
  }
  const calculated = threeLineBreak(bars);
  const before = calculated.at(-2), current = calculated.at(-1);
  if (current.beforeLines < 3) return { status: 'short-history', available: bars.length,
    availableLines: current.beforeLines, requiredLines: 3 };
  return { status: 'ready', signal: current.signal,
    previous: { date: before.lastDate || before.time, close: before.close, direction: before.direction },
    latest: { date: current.lastDate || current.time, close: current.close, direction: current.direction },
    reversalPrice: current.reversalPrice, lineCount: current.lineCount,
    distancePct: (current.close / current.reversalPrice - 1) * 100 };
}

export function analyzeLineBreakHistory(history, reference, weeklyHistory = null) {
  const { daily, weekly } = scanPeriods(history, reference, weeklyHistory);
  const week = analyzeBars(weekly, reference.week, 'week');
  if (weeklyHistory) week.supplemented = true;
  return { day: analyzeBars(daily, reference.day, 'day'), week };
}
