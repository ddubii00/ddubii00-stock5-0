// Domestic scans use Naver daily OHLC. Use its native weekly OHLC for charts
// too, not Yahoo's UTC-labelled weekly history plus an extra daily quote.
// Share one short-lived request across the candle and Ichimoku history limits.
export function createKoreanWeeklyLoader({ fetchImpl = (...args) => fetch(...args), now = Date.now } = {}) {
  const cache = new Map();
  return async function loadKoreanWeekly(symbol, limit) {
    const code = String(symbol).replace(/\.(KS|KQ)$/, '');
    if (!/^\d{6}$/.test(code)) throw new Error('국내 종목코드가 잘못되었습니다.');
    let entry = cache.get(code);
    if (!entry || now() - entry.time >= 15_000) {
      entry = { time: now(), promise: null };
      entry.promise = (async () => {
        const response = await fetchImpl(`https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=week&count=2500&requestType=0`, {
          signal: AbortSignal.timeout(20000),
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ko-KR,ko;q=0.9' },
        });
        if (!response.ok) throw new Error(`국내 주봉 조회 실패 (${response.status})`);
        const byDate = new Map();
        for (const match of (await response.text()).matchAll(/item data="([^"]+)"/g)) {
          const [date, open, high, low, close, volume] = match[1].split('|');
          const bar = { time: date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
            open: Number(open), high: Number(high), low: Number(low), close: Number(close), volume: Number(volume) };
          if (/^\d{4}-\d{2}-\d{2}$/.test(bar.time) && ['open', 'high', 'low', 'close'].every(key => Number.isFinite(bar[key]))
            && bar.close > 0) byDate.set(bar.time, bar);
        }
        const rows = [...byDate.values()].sort((a, b) => a.time.localeCompare(b.time));
        if (!rows.length) throw new Error('국내 주봉 자료가 비어 있습니다.');
        return rows;
      })().catch(error => {
        if (cache.get(code) === entry) cache.delete(code);
        throw error; // Never silently switch this chart back to a different feed.
      });
      cache.set(code, entry);
    }
    return (await entry.promise).slice(-Math.max(1, Math.min(Number(limit) || 300, 2200)));
  };
}

export const fetchKoreanWeeklyOhlcv = createKoreanWeeklyLoader();
