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

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`${label}: target not found`);
  return text.replace(from, to);
}

async function patchServer() {
  const path = 'scripts/server.js';
  let s = await read(path);

  const block = `
// STOCK5_FUNDAMENTALS_SERVER_V1
const STOCK5_FUNDAMENTALS_TTL_MS = 1000 * 60 * 60 * 6;
const stockFundamentalsCache = new Map();

function fundamentalNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildStockFundamentals(symbol, summary) {
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
    pbr: fundamentalNumber(stats.priceToBook),
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
  if (quoteType && quoteType !== 'EQUITY') {
    stockFundamentalsCache.set(normalized, { loadedAt: Date.now(), data: null });
    return null;
  }

  const data = buildStockFundamentals(normalized, summary);
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
  stockFundamentalsCache.set(normalized, { loadedAt: Date.now(), data: result });
  return result;
}

app.get('/api/fundamentals', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim();
    if (!symbol) return res.status(400).json({ error: 'symbol required' });

    const data = await loadStockFundamentals(symbol);
    res.set('Cache-Control', 'public, max-age=900, stale-while-revalidate=21600');
    return res.json(data || { symbol: symbol.toUpperCase(), unavailable: true });
  } catch (error) {
    console.error(\`Fundamentals error [\${req.query.symbol}]:\`, error.message);
    return res.status(502).json({ error: error.message });
  }
});

`;

  s = insertBefore(
    s,
    "app.get('/api/ohlcv', async (req, res) => {",
    block,
    'STOCK5_FUNDAMENTALS_SERVER_V1',
    path,
  );

  await write(path, s);
}

async function patchApp() {
  const path = 'src/App.jsx';
  let s = await read(path);

  // 헤더 등락률: 소수점 1자리
  s = replaceOnce(
    s,
    "  return `${sign}${n.toFixed(2)}%`;\n",
    "  return `${sign}${n.toFixed(1)}%`; // STOCK5_HEADER_NUMBER_FORMAT_V1\n",
    path,
  );

  // 헤더 지수/환율 및 절대 변화량: 소수점 제거
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
}

async function patchChartColumn() {
  const path = 'src/components/ChartColumn.jsx';
  let s = await read(path);

  const helpers = `
// STOCK5_FUNDAMENTALS_UI_V1
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

function formatMetricPercent(value, { alreadyPercent = false, signed = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const pct = alreadyPercent ? n : n * 100;
  const sign = signed && pct > 0 ? '+' : '';
  return \`\${sign}\${pct.toFixed(1)}%\`;
}
`;

  s = insertBefore(
    s,
    'export default function ChartColumn(',
    helpers,
    'STOCK5_FUNDAMENTALS_UI_V1',
    path,
  );

  s = insertAfter(
    s,
    '  const [quote, setQuote] = useState(null);\n',
    `  const [fundamentals, setFundamentals] = useState(null);
`,
    'const [fundamentals, setFundamentals]',
    path,
  );

  const effect = `
  // STOCK5_FUNDAMENTALS_FETCH_V1
  useEffect(() => {
    if (!symbol) {
      setFundamentals(null);
      return undefined;
    }

    const controller = new AbortController();
    setFundamentals(null);

    fetch(apiUrl(\`/fundamentals?symbol=\${encodeURIComponent(symbol)}\`), {
      signal: controller.signal,
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

  s = insertBefore(
    s,
    '  useEffect(() => {\n    ser.current.candle?.applyOptions',
    effect,
    'STOCK5_FUNDAMENTALS_FETCH_V1',
    path,
  );

  const row = `        {fundamentals && (
          <div className="fundamentals-row" title="최근 제공 재무지표">
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

  const symbolBlockEnd = `        )}
        {error && <div className="error-bar">{error}</div>}
`;

  const replacement = `        )}
${row}        {error && <div className="error-bar">{error}</div>}
`;

  if (!s.includes('className="fundamentals-row"')) {
    if (!s.includes(symbolBlockEnd)) {
      throw new Error(`${path}: symbol row target not found`);
    }
    s = s.replace(symbolBlockEnd, replacement);
  }

  await write(path, s);
}

async function patchCss() {
  const path = 'src/index.css';
  let s = await read(path);

  // 헤더 지수 사이를 약간 띄운다.
  s = s.replace(
    /\.market-summary \{([\s\S]*?)gap:\s*1px;/,
    '.market-summary {$1gap: 2px; /* STOCK5_HEADER_GAP_V1 */',
  );
  s = s.replace(
    /(\.market-item \+ \.market-item::before \{[\s\S]*?)margin:\s*0 1px 0 0;/,
    '$1margin: 0 5px 0 3px;',
  );

  if (!s.includes('STOCK5_FUNDAMENTALS_STYLE_V1')) {
    s += `

/* STOCK5_FUNDAMENTALS_STYLE_V1 */
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
  console.log('OK: header number format + compact stock fundamentals row applied');
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
