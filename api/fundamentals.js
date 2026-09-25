import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const TTL_MS = 1000 * 60 * 60 * 6;
const cache = new Map();

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function naverScalar(value) {
  if (value == null) return null;
  const cleaned = String(value)
    .replace(/,/g, '')
    .replace(/\+/g, '')
    .trim();
  if (!cleaned || cleaned === '-' || cleaned === '_') return null;
  const n = Number(cleaned.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function naverWon(value) {
  if (value == null) return null;
  const text = String(value).replace(/,/g, '').trim();
  if (!text || text === '-' || text === '_') return null;

  let total = 0;
  let found = false;
  const units = { 조: 1e12, 억: 1e8, 만: 1e4 };

  for (const match of text.matchAll(/(-?[0-9.]+)\s*(조|억|만)/g)) {
    const n = Number(match[1]);
    if (!Number.isFinite(n)) continue;
    total += n * units[match[2]];
    found = true;
  }

  return found ? total : naverScalar(text);
}

function isKorean(symbol) {
  return /^\d{6}(\.(KS|KQ))?$/.test(String(symbol || '').toUpperCase());
}

function financeRowValue(financeInfo, title, periodKey) {
  if (!periodKey) return null;
  const target = String(title).replace(/\s+/g, '');
  const row = (financeInfo?.rowList || []).find((item) => {
    const normalized = String(item?.title || '')
      .replace(/\s+/g, '')
      .replace(/\(%\)/g, '');
    return normalized === target || normalized.startsWith(target);
  });
  return naverScalar(row?.columns?.[periodKey]?.value);
}

function latestActualPeriod(financeInfo) {
  const actual = (financeInfo?.trTitleList || [])
    .filter((item) => item?.key && String(item?.isConsensus || '').toUpperCase() !== 'Y')
    .map((item) => String(item.key));
  return actual.length ? actual[actual.length - 1] : null;
}

async function fetchJsonLoose(url) {
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      'Referer': 'https://m.stock.naver.com/',
      'User-Agent': 'Mozilla/5.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

async function koreanFundamentals(symbol) {
  const code = String(symbol).replace(/\.(KS|KQ)$/i, '');
  const base = `https://m.stock.naver.com/api/stock/${code}`;

  const [integrationResult, annualResult] = await Promise.allSettled([
    fetchJsonLoose(`${base}/integration`),
    fetchJsonLoose(`${base}/finance/annual`),
  ]);

  const integration = integrationResult.status === 'fulfilled' ? integrationResult.value : {};
  const annual = annualResult.status === 'fulfilled' ? annualResult.value : {};

  const infos = new Map(
    (integration?.totalInfos || [])
      .filter((item) => item?.code)
      .map((item) => [String(item.code), item.value]),
  );

  const financeInfo = annual?.financeInfo || {};
  const actualPeriods = (financeInfo?.trTitleList || [])
    .filter((item) => item?.key && String(item?.isConsensus || '').toUpperCase() !== 'Y')
    .map((item) => String(item.key));
  const period = actualPeriods.at(-1) || null;
  const previousPeriod = actualPeriods.at(-2) || null;

  const revenueEok = financeRowValue(financeInfo, '매출액', period);
  const previousRevenueEok = financeRowValue(financeInfo, '매출액', previousPeriod);
  const operatingProfitEok = financeRowValue(financeInfo, '영업이익', period);
  const annualRoePct = financeRowValue(financeInfo, 'ROE', period);
  const annualOpMarginPct = financeRowValue(financeInfo, '영업이익률', period);

  const eps = naverScalar(infos.get('eps')) ?? financeRowValue(financeInfo, 'EPS', period);
  const bps = naverScalar(infos.get('bps')) ?? financeRowValue(financeInfo, 'BPS', period);
  const per = naverScalar(infos.get('per')) ?? financeRowValue(financeInfo, 'PER', period);
  const pbr = naverScalar(infos.get('pbr')) ?? financeRowValue(financeInfo, 'PBR', period);

  const roePct = Number.isFinite(annualRoePct)
    ? annualRoePct
    : (Number.isFinite(eps) && Number.isFinite(bps) && bps !== 0 ? (eps / bps) * 100 : null);

  const operatingMargin = Number.isFinite(annualOpMarginPct)
    ? annualOpMarginPct / 100
    : (
        Number.isFinite(revenueEok) && revenueEok !== 0 && Number.isFinite(operatingProfitEok)
          ? operatingProfitEok / revenueEok
          : null
      );

  const revenueGrowth = (
    Number.isFinite(revenueEok)
    && Number.isFinite(previousRevenueEok)
    && previousRevenueEok !== 0
  )
    ? (revenueEok - previousRevenueEok) / Math.abs(previousRevenueEok)
    : null;

  return {
    symbol: String(symbol).toUpperCase(),
    source: 'naver',
    period,
    currency: 'KRW',
    marketCap: naverWon(infos.get('marketValue')),
    revenue: Number.isFinite(revenueEok) ? revenueEok * 1e8 : null,
    operatingIncome: Number.isFinite(operatingProfitEok) ? operatingProfitEok * 1e8 : null,
    operatingIncomeEstimated: false,
    pe: Number.isFinite(per) && per > 0 ? per : null,
    peForward: false,
    pbr: Number.isFinite(pbr) && pbr > 0 ? pbr : null,
    roe: Number.isFinite(roePct) ? roePct / 100 : null,
    eps: Number.isFinite(eps) ? eps : null,
    operatingMargin,
    revenueGrowth,
    debtToEquity: null,
    fetchedAt: new Date().toISOString(),
  };
}

function yahooFundamentals(symbol, summary) {
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
  const pe = Number.isFinite(trailingPe) && trailingPe > 0
    ? trailingPe
    : (Number.isFinite(forwardPe) && forwardPe > 0 ? forwardPe : null);
  const pbrValue = numberOrNull(stats.priceToBook);

  return {
    symbol,
    source: 'yahoo',
    currency: String(financial.financialCurrency || price.currency || detail.currency || '').toUpperCase(),
    marketCap,
    revenue,
    operatingIncome,
    operatingIncomeEstimated,
    pe,
    peForward: !(Number.isFinite(trailingPe) && trailingPe > 0) && Number.isFinite(forwardPe) && forwardPe > 0,
    pbr: Number.isFinite(pbrValue) && pbrValue > 0 ? pbrValue : null,
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
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(cached.data || { symbol, unavailable: true });
    }

    let data = null;

    if (isKorean(symbol)) {
      data = await koreanFundamentals(symbol);
    } else {
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
      if (!quoteType || quoteType === 'EQUITY') {
        data = yahooFundamentals(symbol, summary);
      }
    }

    const hasAny = data && [
      data.marketCap,
      data.revenue,
      data.operatingIncome,
      data.pe,
      data.pbr,
      data.roe,
      data.eps,
    ].some((value) => Number.isFinite(value));

    const result = hasAny ? data : null;
    cache.set(symbol, { loadedAt: Date.now(), data: result });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(result || { symbol, unavailable: true });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
}
