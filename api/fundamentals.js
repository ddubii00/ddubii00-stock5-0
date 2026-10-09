import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const TTL_MS = 1000 * 60 * 60 * 6;

function numberOrNull(value) {
  if (value == null || value === '') return null;
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
  const numeric = cleaned.replace(/[^0-9.-]/g, '');
  if (!numeric || !/[0-9]/.test(numeric)) return null;
  const n = Number(numeric);
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

async function fetchJsonLoose(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12000),
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

  return parseKoreanFundamentals(symbol, integration, annual);
}

export function parseKoreanFundamentals(symbol, integration, annual) {
  const infos = new Map(
    (integration?.totalInfos || [])
      .filter((item) => item?.code)
      .map((item) => [String(item.code), item.value]),
  );

  const financeInfo = annual?.financeInfo || {};
  const actualPeriods = (financeInfo?.trTitleList || [])
    .filter((item) => item?.key && String(item?.isConsensus || '').toUpperCase() !== 'Y')
    .map((item) => String(item.key)).sort();
  const period = actualPeriods.at(-1) || null;
  const previousPeriod = actualPeriods.at(-2) || null;
  const forwardPeriod = (financeInfo.trTitleList || [])
    .filter(item => item?.key && String(item.isConsensus).toUpperCase() === 'Y' && (!period || String(item.key) > period))
    .map(item => String(item.key)).sort()[0] || null;
  const forwardPe = financeRowValue(financeInfo, 'PER', forwardPeriod);
  const forwardRoePct = financeRowValue(financeInfo, 'ROE', forwardPeriod);

  const revenueEok = financeRowValue(financeInfo, '매출액', period);
  const previousRevenueEok = financeRowValue(financeInfo, '매출액', previousPeriod);
  const operatingProfitEok = financeRowValue(financeInfo, '영업이익', period);
  const annualRoePct = financeRowValue(financeInfo, 'ROE', period);
  const annualOpMarginPct = financeRowValue(financeInfo, '영업이익률', period);

  const eps = naverScalar(infos.get('eps')) ?? financeRowValue(financeInfo, 'EPS', period);
  const bps = naverScalar(infos.get('bps')) ?? financeRowValue(financeInfo, 'BPS', period);
  const per = naverScalar(infos.get('per')) ?? financeRowValue(financeInfo, 'PER', period);
  const pbr = naverScalar(infos.get('pbr')) ?? financeRowValue(financeInfo, 'PBR', period);
  const annualEps = financeRowValue(financeInfo, 'EPS', period);
  const forwardEps = financeRowValue(financeInfo, 'EPS', forwardPeriod);
  const epsGrowthPct = annualEps > 0 && forwardEps > annualEps
    ? (forwardEps / annualEps - 1) * 100 : null;

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
    marketCapCurrency: 'KRW',
    marketCap: naverWon(infos.get('marketValue')),
    revenue: Number.isFinite(revenueEok) ? revenueEok * 1e8 : null,
    operatingIncome: Number.isFinite(operatingProfitEok) ? operatingProfitEok * 1e8 : null,
    operatingIncomeEstimated: false,
    pe: Number.isFinite(per) && per > 0 ? per : null,
    peForward: false,
    forwardPe: forwardPe > 0 ? forwardPe : null,
    forwardRoe: Number.isFinite(forwardRoePct) ? forwardRoePct / 100 : null,
    forwardPeriod,
    peg: per > 0 && epsGrowthPct > 0 ? per / epsGrowthPct : null,
    pegEstimated: per > 0 && epsGrowthPct > 0,
    pbr: Number.isFinite(pbr) && pbr > 0 ? pbr : null,
    roe: Number.isFinite(roePct) ? roePct / 100 : null,
    eps: Number.isFinite(eps) ? eps : null,
    operatingMargin,
    revenueGrowth,
    debtToEquity: null,
    fetchedAt: new Date().toISOString(),
  };
}

function statementDate(value) {
  const date = new Date(typeof value === 'number' && Math.abs(value) < 1e12 ? value * 1000 : value);
  return value != null && Number.isFinite(date.getTime()) ? date : null;
}

export function parseYahooFundamentals(symbol, summary, statements = []) {
  const price = summary?.price || {};
  const detail = summary?.summaryDetail || {};
  const stats = summary?.defaultKeyStatistics || {};
  const financial = summary?.financialData || {};
  const statement = (Array.isArray(statements) ? statements : [])
    .filter(row => statementDate(row?.date) && (numberOrNull(row.totalRevenue) != null || numberOrNull(row.operatingIncome) != null))
    .sort((a, b) => statementDate(b.date) - statementDate(a.date))[0] || {};

  const marketCap = numberOrNull(price.marketCap ?? detail.marketCap);
  const revenue = numberOrNull(statement.totalRevenue ?? financial.totalRevenue);
  const operatingMargin = numberOrNull(financial.operatingMargins);

  let operatingIncome = numberOrNull(statement.operatingIncome);
  let operatingIncomeEstimated = false;

  if (!Number.isFinite(operatingIncome) && Number.isFinite(numberOrNull(financial.totalRevenue)) && Number.isFinite(operatingMargin)) {
    operatingIncome = Number(financial.totalRevenue) * operatingMargin;
    operatingIncomeEstimated = true;
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
    period: statementDate(statement.date)?.toISOString().slice(0, 10) || null,
    periodType: 'TTM',
    marketCapCurrency: String(price.currency || detail.currency || '').toUpperCase(),
    currency: String(financial.financialCurrency || price.currency || detail.currency || '').toUpperCase(),
    marketCap,
    revenue,
    operatingIncome,
    operatingIncomeEstimated,
    pe,
    peForward: !(Number.isFinite(trailingPe) && trailingPe > 0) && Number.isFinite(forwardPe) && forwardPe > 0,
    forwardPe: forwardPe > 0 ? forwardPe : null,
    forwardRoe: null,
    peg: numberOrNull(stats.pegRatio),
    pegEstimated: false,
    pbr: Number.isFinite(pbrValue) && pbrValue > 0 ? pbrValue : null,
    roe: numberOrNull(financial.returnOnEquity),
    eps: numberOrNull(stats.trailingEps),
    operatingMargin,
    revenueGrowth: numberOrNull(financial.revenueGrowth),
    debtToEquity: numberOrNull(financial.debtToEquity),
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchYahooFundamentals(symbol) {
  const period1 = new Date(Date.now() - 550 * 24 * 3600 * 1000);
  const moduleOptions = { fetchOptions: { signal: AbortSignal.timeout(12000) } };
  const [summary, statements] = await Promise.all([
    yahooFinance.quoteSummary(symbol, {
      modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData'],
    }, moduleOptions),
    yahooFinance.fundamentalsTimeSeries(symbol, {
      period1, type: 'trailing', module: 'financials',
    // Yahoo now returns periodType "TTM", absent from the installed SDK schema.
    // Normalize dates and validate the consumed numeric fields locally above.
    }, { ...moduleOptions, validateResult: false }).catch(() => []),
  ]);
  const quoteType = String(summary?.price?.quoteType || '').toUpperCase();
  return !quoteType || quoteType === 'EQUITY' ? parseYahooFundamentals(symbol, summary, statements) : null;
}

export function createFundamentalsHandler({ korean = koreanFundamentals, overseas = fetchYahooFundamentals, now = Date.now } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  // Financial data is slow-moving: cache for six hours and limit provider load.
  let active = 0;
  const queue = [];
  const run = task => new Promise((resolve, reject) => {
    const start = () => {
      active += 1;
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        active -= 1;
        queue.shift()?.();
      });
    };
    if (active < 2) start();
    else queue.push(start);
  });
  return async function handler(req, res) {
    const symbol = String(req.query?.symbol || '').trim().toUpperCase();
    if (!symbol) return res.status(400).json({ error: 'symbol required' });

    try {
      const cached = cache.get(symbol);
      if (cached && now() - cached.loadedAt < TTL_MS) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(cached.data || { symbol, unavailable: true });
      }

      if (!inFlight.has(symbol)) {
        const pending = run(() => isKorean(symbol) ? korean(symbol) : overseas(symbol));
        inFlight.set(symbol, pending);
        pending.finally(() => inFlight.delete(symbol)).catch(() => {});
      }
      const data = await inFlight.get(symbol);

      const hasAny = data && [
        data.marketCap,
        data.revenue,
        data.operatingIncome,
        data.pe,
        data.pbr,
        data.roe,
        data.eps,
        data.forwardPe,
        data.forwardRoe,
        data.peg,
      ].some((value) => Number.isFinite(value));

      const result = hasAny ? data : null;
      cache.set(symbol, { loadedAt: now(), data: result });

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(result || { symbol, unavailable: true });
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  };
}

export default createFundamentalsHandler();
