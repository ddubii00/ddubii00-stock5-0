import { RANKING_UNIVERSES } from '../src/marketPresets.js';
import { loadScanUniverse } from './_scanUniverse.js';

export const RANKING_VERSION = 2;
const directoryCache = new Map();

async function listedDirectory(market) {
  const cached = directoryCache.get(market);
  if (cached && Date.now() - cached.created < 6 * 60 * 60 * 1000) return cached.promise;
  const promise = loadScanUniverse(market === 'nikkei' ? 'japan' : market);
  const entry = { created: Date.now(), promise };
  directoryCache.set(market, entry);
  try { return await promise; }
  catch (error) {
    if (directoryCache.get(market) === entry) directoryCache.delete(market);
    throw error;
  }
}

export function previousCloseMarketCap(quote) {
  const previous = Number(quote?.regularMarketPreviousClose);
  const shares = Number(quote?.sharesOutstanding ?? quote?.impliedSharesOutstanding);
  if (shares > 0 && previous > 0 && Number.isFinite(shares * previous)) return shares * previous;
  // 주식 수 미제공 시 현재 시총을 전일 종가/현재가 비율로 보정한다.
  const cap = Number(quote?.marketCap), price = Number(quote?.regularMarketPrice);
  if (cap > 0 && price > 0 && previous > 0 && Number.isFinite(cap * previous / price)) return cap * previous / price;
  return null;
}

export async function loadForeignRankings(market, {
  quote, summary, directory = listedDirectory, universe = RANKING_UNIVERSES[market], concurrency = 3,
} = {}) {
  const expectedCount = market === 'nikkei' ? 50 : 100;
  let symbols = [...new Set(universe || [])], directoryWarning = '';
  try {
    const listed = new Set((await directory(market)).items.map(item => item.symbol));
    symbols = symbols.filter(symbol => listed.has(symbol));
  } catch {
    directoryWarning = '공식 상장 목록 확인이 지연되어 갱신된 후보 목록으로 조회했습니다.';
  }
  const rows = [], unavailable = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, async () => {
    while (cursor < symbols.length) {
      const symbol = symbols[cursor++];
      try {
        let value, lastError;
        for (let attempt = 0; attempt < 2; attempt++) {
          try { value = await quote(symbol); break; }
          catch (error) { lastError = error; }
        }
        if (!value && lastError) throw lastError;
        if (value?.quoteType && value.quoteType !== 'EQUITY') throw new Error('주식 시세가 아닙니다.');
        let marketCap = previousCloseMarketCap(value);
        if (!marketCap && summary) {
          const fallback = await summary(symbol);
          value = { ...value, ...fallback?.price, ...fallback?.defaultKeyStatistics };
          marketCap = previousCloseMarketCap(value);
        }
        if (!marketCap) throw new Error('전일 종가/시가총액 미제공');
        rows.push({ symbol, name: String(value.shortName || value.longName || value.displayName || symbol), marketCap });
      } catch (error) {
        unavailable.push({ symbol, reason: String(error?.message || '시세 조회 실패').slice(0, 160) });
      }
    }
  }));
  if (!rows.length) throw new Error('해외 시세를 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  const items = rows.sort((a, b) => b.marketCap - a.marketCap || a.symbol.localeCompare(b.symbol))
    .slice(0, expectedCount).map(({ symbol, name }, index) => ({ symbol, name, rank: index + 1 }));
  const incomplete = items.length < expectedCount;
  const warning = [directoryWarning, incomplete ? `${expectedCount}종목 중 ${items.length}종목을 우선 표시합니다.` : '',
    unavailable.length ? `후보 ${unavailable.length}종목 시세 미제공. 순위는 조회 성공 후보 내 전일 종가 추정 시가총액 기준입니다.` : ''].filter(Boolean).join(' ');
  return { items, expectedCount, complete: !incomplete && !unavailable.length && !directoryWarning,
    unavailable, warning, rankingVersion: RANKING_VERSION, rankingBasis: 'candidate-previous-close-estimate' };
}
