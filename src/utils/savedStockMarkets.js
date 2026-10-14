export const SAVED_STOCK_MARKETS = [
  ['kospi', 'KOSPI'], ['kosdaq', 'KOSDAQ'],
  ['us', '미국 (NASDAQ 등)'], ['japan', '일본'], ['other', '기타 / 시장 미확인'],
];

// Shared records store symbols, not a verified US exchange. Do not label every
// bare ticker as NASDAQ or guess the market of an old six-digit Korean code.
export function savedStockMarket(rawSymbol) {
  const symbol = String(rawSymbol || '').trim().toUpperCase();
  if (/^\d{6}\.KS$/.test(symbol)) return 'kospi';
  if (/^\d{6}\.KQ$/.test(symbol)) return 'kosdaq';
  if (/^[A-Z0-9]{4}\.T$/.test(symbol)) return 'japan';
  if (/^[A-Z][A-Z0-9-]*(?:\.[AB])?$/.test(symbol)) return 'us';
  return 'other';
}

export function filterSavedStocks(positions, market = 'all', query = '') {
  const text = String(query || '').trim().toLowerCase();
  return Object.values(positions).filter(stock => (market === 'all' || savedStockMarket(stock.symbol) === market)
    && `${stock.name || ''} ${stock.symbol || ''}`.toLowerCase().includes(text));
}
