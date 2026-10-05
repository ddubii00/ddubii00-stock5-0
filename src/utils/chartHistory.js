export const MA_WARMUP_BARS = 199;
export const MAX_OHLCV_HISTORY = 2200;

export function mainHistoryRequestLimit(interval, visibleBars) {
  const intraday = ['1m', '3m', '5m', '15m', '30m', '60m'].includes(interval);
  const buffer = intraday ? 1200 : 720;
  return Math.min(Math.max(visibleBars + buffer, visibleBars * 4), MAX_OHLCV_HISTORY);
}

// Keep the calculation-only bars out of every plotted main-chart series.
// When a provider supplies too little history, keep the requested candles:
// missing MA200 values must remain missing, never replaced by shorter averages.
export function mainHistoryWindow(history, visibleBars) {
  const count = Math.min(Math.max(Number(visibleBars) || 120, 1), history.length);
  const start = Math.min(MA_WARMUP_BARS, history.length - count);
  return {
    start,
    candles: history.slice(start),
    missingVisibleMA200: Math.min(count, Math.max(0, MA_WARMUP_BARS - start)),
  };
}
