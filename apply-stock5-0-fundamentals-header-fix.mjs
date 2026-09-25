import { readFile, writeFile } from 'node:fs/promises';

async function read(path) {
  return readFile(path, 'utf8');
}

async function write(path, text) {
  await writeFile(path, text, 'utf8');
  console.log(`updated: ${path}`);
}

function insertBefore(text, anchor, addition, marker, label) {
  if (text.includes(marker)) return text;
  const index = text.indexOf(anchor);
  if (index < 0) throw new Error(`${label}: anchor not found`);
  return text.slice(0, index) + addition + text.slice(index);
}

function insertAfter(text, anchor, addition, marker, label) {
  if (text.includes(marker)) return text;
  const index = text.indexOf(anchor);
  if (index < 0) throw new Error(`${label}: anchor not found`);
  return text.slice(0, index + anchor.length) + addition + text.slice(index + anchor.length);
}

async function patchServer() {
  const path = 'scripts/server.js';
  let s = await read(path);

  const block = `
// STOCK5_FUNDAMENTALS_SERVER_V2
const STOCK5_FUNDAMENTALS_TTL_MS = 1000 * 60 * 60 * 6;
const stockFundamentalsCache = new Map();

function fundamentalNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function naverScalar(value) {
  if (value == null) return null;
  const cleaned = String(value)
    .replace(/,/g, '')
    .replace(/\\+/g, '')
    .trim();
  if (!cleaned || cleaned === '-' || cleaned === '_') return null;
  const n = Number(cleaned.replace(/[^0-9.\\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function naverWon(value) {
  if (value == null) return null;
  const text = String(value).replace(/,/g, '').trim();
  if (!text || text === '-' || text === '_') return null;

  let total = 0;
  let found = false;
  const units = { 조: 1e12, 억: 1e8, 만: 1e4 };
  for (const match of text.matchAll(/(-?[0-9.]+)\\s*(조|억|만)/g)) {
    const n = Number(match[1]);
    if (!Number.isFinite(n)) continue;
    total += n * units[match[2]];
    found = true;
  }
  if (found) return total;

  return naverScalar(text);
}

function isKoreanFundamentalSymbol(symbol) {
  return /^\\d{6}(\\.(KS|KQ))?$/.test(String(symbol || '').toUpperCase());
}

function financeRowValue(financeInfo, title, periodKey) {
  if (!periodKey) return null;
  const normalizedTarget = String(title).replace(/\\s+/g, '');
  const row = (financeInfo?.rowList || []).find((item) => {
    const normalized = String(item?.title || '')
      .replace(/\\s+/g, '')
      .replace(/\\(%\\)/g, '');
    return normalized === normalizedTarget || normalized.startsWith(normalizedTarget);
  });
  return naverScalar(row?.columns?.[periodKey]?.value);
}

function latestActualPeriod(financeInfo) {
  const actual = (financeInfo?.trTitleList || [])
    .filter((item) => item?.key && String(item?.isConsensus || '').toUpperCase() !== 'Y')
    .map((item) => String(item.key));
  return actual.length ? actual[actual.length - 1] : null;
}

function previousActualPeriod(financeInfo, latestKey) {
  const actual = (financeInfo?.trTitleList || [])
    .filter((item) => item?.key && String(item?.isConsensus || '').toUpperCase() !== 'Y')
    .map((item) => String(item.key));
  const index = actual.lastIndexOf(String(latestKey || ''));
  return index > 0 ? actual[index - 1] : null;
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
  if (!response.ok) throw new Error(\`HTTP \${response.status}: \${url}\`);
  return response.json();
}

async function loadKoreanFundamentals(symbol) {
  const code = cleanKoreanCode(symbol);
  const base = \`https://m.stock.naver.com/api/stock/\${code}\`;

  const [integrationResult, annualResult] = await Promise.allSettled([
    fetchJsonLoose(\`\${base}/integration\`),
    fetchJsonLoose(\`\${base}/finance/annual\`),
  ]);

  const integration = integrationResult.status === 'fulfilled' ? integrationResult.value : {};
  const annual = annualResult.status === 'fulfilled' ? annualResult.value : {};
  const infos = new Map(
    (integration?.totalInfos || [])
      .filter((item) => item?.code)
      .map((item) => [String(item.code), item.value]),
  );

  const financeInfo = annual?.financeInfo || {};
  const period = latestActualPeriod(financeInfo);
  const previousPeriod = previousActualPeriod(financeInfo, period);

  const revenueEok = financeRowValue(financeInfo, '매출액', period);
  const previousRevenueEok = financeRowValue(financeInfo, '매출액', previousPeriod);
  const operatingProfitEok = financeRowValue(financeInfo, '영업이익', period);
  const annualRoePct = financeRowValue(financeInfo, 'ROE', period);
  const annualOpMarginPct = financeRowValue(financeInfo, '영업이익률', period);

  const eps = naverScalar(infos.get('eps'))
    ?? financeRowValue(financeInfo, 'EPS', period);
  const bps = naverScalar(infos.get('bps'))
    ?? financeRowValue(financeInfo, 'BPS', period);
  const per = naverScalar(infos.get('per'))
    ?? financeRowValue(financeInfo, 'PER', period);
  const pbr = naverScalar(infos.get('pbr'))
    ?? financeRowValue(financeInfo, 'PBR', period);

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

function buildYahooFundamentals(symbol, summary) {
  const price = summary?.price || {};
  const detail = summary?.summaryDetail || {};
  const stats = summary?.defaultKeyStatistics || {};
  const financial = summary?.financialData || {};
  const statement = summary?.incomeStatementHistory?.incomeStatementHistory?.[0] || {};

  const marketCap = fundamentalNumber(price.marketCap ?? detail.marketCap);
  const revenue = fundamentalNumber(financial.totalRevenue ?? statement.totalRevenue);
  const operatingMargin = fundamentalNumber(financial.operatingMargins);

  let operatingIncome = null;
  let operatingIncomeEstimated = false;

  if (Number.isFinite(revenue) && Number.isFinite(operatingMargin)) {
    operatingIncome = revenue * operatingMargin;
    operatingIncomeEstimated = true;
  } else {
    operatingIncome = fundamentalNumber(statement.operatingIncome);
    if (!Number.isFinite(operatingIncome)) {
      operatingIncome = fundamentalNumber(statement.ebit);
      operatingIncomeEstimated = Number.isFinite(operatingIncome);
    }
  }

  const trailingPe = fundamentalNumber(detail.trailingPE);
  const forwardPe = fundamentalNumber(detail.forwardPE ?? stats.forwardPE);
  const pe = Number.isFinite(trailingPe) && trailingPe > 0
    ? trailingPe
    : (Number.isFinite(forwardPe) && forwardPe > 0 ? forwardPe : null);

  const pbrValue = fundamentalNumber(stats.priceToBook);

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
    roe: fundamentalNumber(financial.returnOnEquity),
    eps: fundamentalNumber(stats.trailingEps),
    operatingMargin,
    revenueGrowth: fundamentalNumber(financial.revenueGrowth),
    debtToEquity: fundamentalNumber(financial.debtToEquity),
    fetchedAt: new Date().toISOString(),
  };
}

async function loadStockFundamentals(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) return null;

  const cached = stockFundamentalsCache.get(normalized);
  if (cached && Date.now() - cached.loadedAt < STOCK5_FUNDAMENTALS_TTL_MS) {
    return cached.data;
  }

  let data = null;

  if (isKoreanFundamentalSymbol(normalized)) {
    data = await loadKoreanFundamentals(normalized);
  } else {
    const summary = await yahooCall(() => yahooFinance.quoteSummary(normalized, {
      modules: [
        'price',
        'summaryDetail',
        'defaultKeyStatistics',
        'financialData',
        'incomeStatementHistory',
      ],
    }), 1);

    const quoteType = String(summary?.price?.quoteType || '').toUpperCase();
    if (!quoteType || quoteType === 'EQUITY') {
      data = buildYahooFundamentals(normalized, summary);
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
  stockFundamentalsCache.set(normalized, { loadedAt: Date.now(), data: result });
  return result;
}

app.get('/api/fundamentals', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim();
    if (!symbol) return res.status(400).json({ error: 'symbol required' });

    const data = await loadStockFundamentals(symbol);
    res.set('Cache-Control', 'no-store');
    return res.json(data || { symbol: symbol.toUpperCase(), unavailable: true });
  } catch (error) {
    console.error(\`Fundamentals error [\${req.query.symbol}]:\`, error.message);
    return res.status(502).json({ error: error.message });
  }
});

`;

  const oldStart = s.indexOf('// STOCK5_FUNDAMENTALS_SERVER_V1');
  const oldV2Start = s.indexOf('// STOCK5_FUNDAMENTALS_SERVER_V2');
  const routeAnchor = "app.get('/api/ohlcv', async (req, res) => {";

  if (oldV2Start >= 0) {
    console.log(`${path}: fundamentals server V2 already applied`);
  } else if (oldStart >= 0) {
    const end = s.indexOf(routeAnchor, oldStart);
    if (end < 0) throw new Error(`${path}: fundamentals V1 end anchor not found`);
    s = s.slice(0, oldStart) + block + s.slice(end);
  } else {
    s = insertBefore(
      s,
      routeAnchor,
      block,
      'STOCK5_FUNDAMENTALS_SERVER_V2',
      path,
    );
  }

  await write(path, s);
}

async function patchApp() {
  const path = 'src/App.jsx';
  let s = await read(path);

  if (!s.includes('STOCK5_HEADER_NUMBER_FORMAT_V2')) {
    const percentV2 = "  return `${sign}${n.toFixed(1)}%`; // STOCK5_HEADER_NUMBER_FORMAT_V2\n";
    const percentV1 = "  return `${sign}${n.toFixed(1)}%`; // STOCK5_HEADER_NUMBER_FORMAT_V1\n";
    const percentOriginal = "  return `${sign}${n.toFixed(2)}%`;\n";
    if (s.includes(percentV1)) s = s.replace(percentV1, percentV2);
    else if (s.includes(percentOriginal)) s = s.replace(percentOriginal, percentV2);
    else throw new Error(`${path}: header percent formatter target not found`);

    s = s.replaceAll('formatFixed(marketSummary.usdKrw.price, 2)', 'formatFixed(marketSummary.usdKrw.price, 0)');
    s = s.replaceAll('formatSignedFixed(marketSummary.usdKrw.change, 2)', 'formatSignedFixed(marketSummary.usdKrw.change, 0)');
    s = s.replaceAll('formatFixed(marketSummary.kospi.price, 2)', 'formatFixed(marketSummary.kospi.price, 0)');
    s = s.replaceAll('formatSignedFixed(marketSummary.kospi.change, 2)', 'formatSignedFixed(marketSummary.kospi.change, 0)');
    s = s.replaceAll('formatFixed(marketSummary.kosdaq.price, 2)', 'formatFixed(marketSummary.kosdaq.price, 0)');
    s = s.replaceAll('formatSignedFixed(marketSummary.kosdaq.change, 2)', 'formatSignedFixed(marketSummary.kosdaq.change, 0)');
    s = s.replaceAll('formatFixed(marketSummary.nasdaq.price, 2)', 'formatFixed(marketSummary.nasdaq.price, 0)');
    s = s.replaceAll('formatSignedFixed(marketSummary.nasdaq.change, 2)', 'formatSignedFixed(marketSummary.nasdaq.change, 0)');
    s = s.replaceAll('formatFixed(marketSummary.sp500.price, 2)', 'formatFixed(marketSummary.sp500.price, 0)');
    s = s.replaceAll('formatSignedFixed(marketSummary.sp500.change, 2)', 'formatSignedFixed(marketSummary.sp500.change, 0)');

    await write(path, s);
  } else {
    console.log(`${path}: header format V2 already applied`);
  }
}

async function patchChartColumn() {
  const path = 'src/components/ChartColumn.jsx';
  let s = await read(path);

  const helpers = `
// STOCK5_FUNDAMENTALS_UI_V2
function compactMetricNumber(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatMetricMoney(value, currency) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const code = String(currency || '').toUpperCase();
  const abs = Math.abs(n);

  if (code === 'KRW') {
    if (abs >= 1e12) return \`\${compactMetricNumber(n / 1e12, 1)}조\`;
    if (abs >= 1e8) return \`\${compactMetricNumber(n / 1e8, 0)}억\`;
    return \`₩\${Math.round(n).toLocaleString('ko-KR')}\`;
  }

  const prefix = code === 'USD' ? '$' : code === 'JPY' ? '¥' : code ? \`\${code} \` : '';
  if (abs >= 1e12) return \`\${prefix}\${compactMetricNumber(n / 1e12, 2)}T\`;
  if (abs >= 1e9) return \`\${prefix}\${compactMetricNumber(n / 1e9, 1)}B\`;
  if (abs >= 1e6) return \`\${prefix}\${compactMetricNumber(n / 1e6, 1)}M\`;
  return \`\${prefix}\${compactMetricNumber(n, 0)}\`;
}

function formatMetricEps(value, currency) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const code = String(currency || '').toUpperCase();
  if (code === 'KRW') return \`₩\${Math.round(n).toLocaleString('ko-KR')}\`;
  if (code === 'USD') return \`$\${compactMetricNumber(n, 2)}\`;
  if (code === 'JPY') return \`¥\${compactMetricNumber(n, 1)}\`;
  return \`\${code ? \`\${code} \` : ''}\${compactMetricNumber(n, 2)}\`;
}

function formatMetricRatio(value, digits = 1) {
  return Number.isFinite(Number(value)) ? compactMetricNumber(value, digits) : '-';
}

function formatMetricPercent(value, { signed = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const pct = n * 100;
  const sign = signed && pct > 0 ? '+' : '';
  return \`\${sign}\${pct.toFixed(1)}%\`;
}
`;

  if (!s.includes('STOCK5_FUNDAMENTALS_UI_V2')) {
    if (s.includes('// STOCK5_FUNDAMENTALS_UI_V1')) {
      const start = s.indexOf('// STOCK5_FUNDAMENTALS_UI_V1');
      const end = s.indexOf('export default function ChartColumn(', start);
      if (end < 0) throw new Error(`${path}: old fundamentals helper end not found`);
      s = s.slice(0, start) + helpers + '\n' + s.slice(end);
    } else {
      s = insertBefore(
        s,
        'export default function ChartColumn(',
        helpers,
        'STOCK5_FUNDAMENTALS_UI_V2',
        path,
      );
    }
  }

  if (!s.includes('const [fundamentals, setFundamentals]')) {
    s = insertAfter(
      s,
      '  const [quote, setQuote] = useState(null);\n',
      '  const [fundamentals, setFundamentals] = useState(null);\n',
      'const [fundamentals, setFundamentals]',
      path,
    );
  }

  const effect = `
  // STOCK5_FUNDAMENTALS_FETCH_V2
  useEffect(() => {
    if (!symbol) {
      setFundamentals(null);
      return undefined;
    }

    const controller = new AbortController();
    setFundamentals(null);

    fetch(apiUrl(\`/fundamentals?symbol=\${encodeURIComponent(symbol)}\`), {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(\`fundamentals \${response.status}\`);
        return response.json();
      })
      .then((payload) => {
        if (!payload?.unavailable) setFundamentals(payload);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          console.warn(\`재무지표 조회 실패 [\${symbol}]\`, error);
        }
      });

    return () => controller.abort();
  }, [symbol]);

`;

  if (!s.includes('STOCK5_FUNDAMENTALS_FETCH_V2')) {
    if (s.includes('// STOCK5_FUNDAMENTALS_FETCH_V1')) {
      const start = s.indexOf('  // STOCK5_FUNDAMENTALS_FETCH_V1');
      const endAnchor = '  useEffect(() => {\n    ser.current.candle?.applyOptions';
      const end = s.indexOf(endAnchor, start);
      if (end < 0) throw new Error(`${path}: old fundamentals fetch end not found`);
      s = s.slice(0, start) + effect + s.slice(end);
    } else {
      s = insertBefore(
        s,
        '  useEffect(() => {\n    ser.current.candle?.applyOptions',
        effect,
        'STOCK5_FUNDAMENTALS_FETCH_V2',
        path,
      );
    }
  }

  const row = `        {fundamentals && (
          <div className="fundamentals-row" title={fundamentals.source === 'naver' ? '네이버 금융 최근 확정 실적/현재 지표' : 'Yahoo Finance 최근 제공 지표'}>
            <span>시총 <b>{formatMetricMoney(fundamentals.marketCap, fundamentals.currency)}</b></span>
            <span>매출 <b>{formatMetricMoney(fundamentals.revenue, fundamentals.currency)}</b></span>
            <span>{fundamentals.operatingIncomeEstimated ? '영업익≈' : '영업익'} <b>{formatMetricMoney(fundamentals.operatingIncome, fundamentals.currency)}</b></span>
            <span>{fundamentals.peForward ? 'PER(F)' : 'PER'} <b>{formatMetricRatio(fundamentals.pe, 1)}</b></span>
            <span>PBR <b>{formatMetricRatio(fundamentals.pbr, 2)}</b></span>
            <span>ROE <b>{formatMetricPercent(fundamentals.roe)}</b></span>
            <span>EPS <b>{formatMetricEps(fundamentals.eps, fundamentals.currency)}</b></span>
            <span>영업M <b>{formatMetricPercent(fundamentals.operatingMargin)}</b></span>
            <span>매출성장 <b>{formatMetricPercent(fundamentals.revenueGrowth, { signed: true })}</b></span>
          </div>
        )}
`;

  if (!s.includes('className="fundamentals-row"')) {
    const target = `        )}
        {error && <div className="error-bar">{error}</div>}
`;
    if (!s.includes(target)) throw new Error(`${path}: symbol row target not found`);
    s = s.replace(
      target,
      `        )}
${row}        {error && <div className="error-bar">{error}</div>}
`,
    );
  }

  await write(path, s);
}

async function patchCss() {
  const path = 'src/index.css';
  let s = await read(path);

  // 헤더 지수 사이 간격
  s = s.replace(/gap:\s*1px;/, 'gap: 2px; /* STOCK5_HEADER_GAP_V2 */');
  s = s.replace(/margin:\s*0 1px 0 0;/, 'margin: 0 5px 0 3px;');

  // MacBook Pro에서도 2칼럼이 화면 폭 안에 유지되도록 grid item의 min-content 폭을 제거.
  s = s.replace(
    '@media (min-width: 768px) {\n  .dashboard-grid { grid-template-columns: repeat(2, 1fr); }\n}',
    '@media (min-width: 768px) {\n  .dashboard-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n}',
  );

  if (s.includes('.chart-column {') && !s.includes('/* STOCK5_TWO_COLUMN_WIDTH_V2 */')) {
    s = s.replace(
      '.chart-column {\n',
      '.chart-column {\n  min-width: 0; /* STOCK5_TWO_COLUMN_WIDTH_V2 */\n',
    );
  }

  // 이전 검색창 배치 패치의 180/150px을 더 작게 줄인다.
  s = s.replace(
    `.search-position-search {
  flex: 1 1 180px;
  min-width: 150px;
}`,
    `.search-position-search {
  flex: 0 1 150px;
  width: 150px;
  min-width: 90px;
  max-width: 150px;
}`,
  );

  s = s.replace(
    `.search-position-row {
  display: flex;
  align-items: center;
  gap: 7px;`,
    `.search-position-row {
  display: flex;
  align-items: center;
  gap: 4px;`,
  );

  if (!s.includes('STOCK5_FUNDAMENTALS_STYLE_V2')) {
    s += `

/* STOCK5_FUNDAMENTALS_STYLE_V2 */
.column-header,
.controls-row,
.search-position-row {
  min-width: 0;
}

.search-position-row .position-mini-controls {
  min-width: 0;
}

.fundamentals-row {
  display: flex;
  align-items: baseline;
  min-width: 0;
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  color: #64748b;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 1.35;
  scrollbar-width: none;
}

.fundamentals-row::-webkit-scrollbar {
  display: none;
}

.fundamentals-row span {
  flex: 0 0 auto;
}

.fundamentals-row span + span::before {
  content: '·';
  color: #cbd5e1;
  margin: 0 5px;
}

.fundamentals-row b {
  color: #334155;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
`;
  }

  await write(path, s);
}

async function main() {
  await patchServer();
  await patchApp();
  await patchChartColumn();
  await patchCss();
  console.log('OK: Korean Naver fundamentals + MacBook 2-column width V2 applied');
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
