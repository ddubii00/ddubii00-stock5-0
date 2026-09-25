import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const TTL_MS = 1000 * 60 * 60 * 6;
const cache = new Map();

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildFundamentals(symbol, summary) {
  const price = summary?.price || {};
  const detail = summary?.summaryDetail || {};
  const stats = summary?.defaultKeyStatistics || {};
  const financial = summary?.financialData || {};
  const statement = summary?.incomeStatementHistory?.incomeStatementHistory?.[0] || {};

  const marketCap = numberOrNull(price.marketCap ?? detail.marketCap);
  const revenue = numberOrNull(financial.totalRevenue ?? statement.totalRevenue);
  const operatingMargin = numberOrNull(financial.operatingMargins);

  let operatingIncome = null;
  let operatingIncomeEstimated = false;

  if (Number.isFinite(revenue) && Number.isFinite(operatingMargin)) {
    operatingIncome = revenue * operatingMargin;
    operatingIncomeEstimated = true;
  } else {
    operatingIncome = numberOrNull(statement.operatingIncome);
    if (!Number.isFinite(operatingIncome)) {
      operatingIncome = numberOrNull(statement.ebit);
      operatingIncomeEstimated = Number.isFinite(operatingIncome);
    }
  }

  const trailingPe = numberOrNull(detail.trailingPE);
  const forwardPe = numberOrNull(detail.forwardPE ?? stats.forwardPE);
  const pe = Number.isFinite(trailingPe) ? trailingPe : forwardPe;

  return {
    symbol,
    currency: String(financial.financialCurrency || price.currency || detail.currency || '').toUpperCase(),
    marketCap,
    revenue,
    operatingIncome,
    operatingIncomeEstimated,
    pe,
    peForward: !Number.isFinite(trailingPe) && Number.isFinite(forwardPe),
    pbr: numberOrNull(stats.priceToBook),
    roe: numberOrNull(financial.returnOnEquity),
    eps: numberOrNull(stats.trailingEps),
    operatingMargin,
    revenueGrowth: numberOrNull(financial.revenueGrowth),
    debtToEquity: numberOrNull(financial.debtToEquity),
    fetchedAt: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  const symbol = String(req.query?.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  try {
    const cached = cache.get(symbol);
    if (cached && Date.now() - cached.loadedAt < TTL_MS) {
      res.setHeader('Cache-Control', 'public, max-age=900, stale-while-revalidate=21600');
      return res.status(200).json(cached.data || { symbol, unavailable: true });
    }

    const summary = await yahooFinance.quoteSummary(symbol, {
      modules: [
        'price',
        'summaryDetail',
        'defaultKeyStatistics',
        'financialData',
        'incomeStatementHistory',
      ],
    });

    const quoteType = String(summary?.price?.quoteType || '').toUpperCase();
    if (quoteType && quoteType !== 'EQUITY') {
      cache.set(symbol, { loadedAt: Date.now(), data: null });
      return res.status(200).json({ symbol, unavailable: true });
    }

    const data = buildFundamentals(symbol, summary);
    const hasAny = [
      data.marketCap,
      data.revenue,
      data.operatingIncome,
      data.pe,
      data.pbr,
      data.roe,
      data.eps,
    ].some(Number.isFinite);

    const result = hasAny ? data : null;
    cache.set(symbol, { loadedAt: Date.now(), data: result });

    res.setHeader('Cache-Control', 'public, max-age=900, stale-while-revalidate=21600');
    return res.status(200).json(result || { symbol, unavailable: true });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
}
