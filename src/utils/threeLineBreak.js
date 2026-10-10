// stock5-8-compatible close-based three-line break. Chart and scanner share
// this calculation so a scan signal and its drawn reversal use the same rule.
// https://www.tradingview.com/support/solutions/43000502273-introduction-to-line-break-charts/
export function threeLineBreak(bars = []) {
  const source = bars.filter(bar => Number.isFinite(bar?.close) && bar.time != null);
  const lines = [];
  let volume = 0, volumeKnown = true, sourceCount = 0, startTime = null;
  return source.map((bar, index) => {
    if (!sourceCount) startTime = bar.time;
    sourceCount++;
    if (typeof bar.volume === 'number' && Number.isFinite(bar.volume) && bar.volume >= 0) volume += bar.volume;
    else volumeKnown = false;
    const last = lines.at(-1);
    const recent = lines.slice(-3);
    const upper = recent.length ? Math.max(...recent.map(line => line.high)) : null;
    const lower = recent.length ? Math.min(...recent.map(line => line.low)) : null;
    const beforeDirection = last ? (last.close > last.open ? 'up' : 'down') : null;
    const beforeLines = lines.length;
    let direction = null;
    if (!last && index && bar.close !== source[0].close) direction = bar.close > source[0].close ? 'up' : 'down';
    else if (last) {
      if (bar.close > upper) direction = 'up';
      else if (bar.close < lower) direction = 'down';
    }
    const reversal = beforeDirection && direction && direction !== beforeDirection;
    const signal = reversal && beforeLines >= 3 ? (direction === 'up' ? 'bullish' : 'bearish') : null;
    let line = null;
    if (direction) {
      const open = !last ? source[0].close : direction === 'up' ? last.high : last.low;
      line = { time: bar.time, open, close: bar.close, high: Math.max(open, bar.close), low: Math.min(open, bar.close),
        volume: volumeKnown ? volume : null, startTime, sourceCount };
      lines.push(line);
      volume = 0; volumeKnown = true; sourceCount = 0;
    }
    const current = lines.at(-1);
    return { ...bar, direction: current ? (current.close > current.open ? 'up' : 'down') : null,
      beforeLines, lineCount: lines.length, signal,
      reversalPrice: beforeDirection === 'down' ? upper : beforeDirection === 'up' ? lower : null,
      generated: Boolean(direction), line };
  });
}

export function calculateThreeLineBreak(candles) {
  // Unconfirmed trailing volume waits for the next generated line. It is not
  // added to an already completed line, and no flat synthetic line is invented.
  return threeLineBreak(candles).filter(row => row.generated).map(row => row.line);
}
