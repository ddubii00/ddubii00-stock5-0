import { readFile, writeFile } from 'node:fs/promises';

async function read(path) {
  return readFile(path, 'utf8');
}

async function write(path, text) {
  await writeFile(path, text, 'utf8');
  console.log(`updated: ${path}`);
}

function insertAfter(text, anchor, addition, marker, label) {
  if (text.includes(marker)) return text;
  const index = text.indexOf(anchor);
  if (index < 0) throw new Error(`${label}: anchor not found`);
  return text.slice(0, index + anchor.length) + addition + text.slice(index + anchor.length);
}

function insertBefore(text, anchor, addition, marker, label) {
  if (text.includes(marker)) return text;
  const index = text.indexOf(anchor);
  if (index < 0) throw new Error(`${label}: anchor not found`);
  return text.slice(0, index) + addition + text.slice(index);
}

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`${label}: target not found`);
  return text.replace(from, to);
}

async function patchServer() {
  const path = 'scripts/server.js';
  let s = await read(path);

  s = insertAfter(
    s,
    "import { analyzeCharts } from '../api/_analyze.js';\n",
    "import { authorized, loadState, saveState } from '../api/_state.js'; // STOCK5_SHARED_STATE_PATCH\n",
    'STOCK5_SHARED_STATE_PATCH',
    path,
  );

  const stateRoute = `\n// STOCK5_SHARED_STATE_ROUTE\napp.all('/api/state', async (req, res) => {\n  if (!authorized(req)) return res.status(401).json({ error: 'invalid password' });\n  try {\n    if (req.method === 'GET') return res.json(await loadState());\n    if (req.method === 'PUT') return res.json(await saveState(req.body));\n    return res.status(405).json({ error: 'method not allowed' });\n  } catch (error) {\n    return res.status(500).json({ error: error.message });\n  }\n});\n`;
  s = insertAfter(
    s,
    "app.use(express.json({ limit: '25mb' }));\n",
    stateRoute,
    'STOCK5_SHARED_STATE_ROUTE',
    path,
  );

  const nameRoute = `\n// STOCK5_SYMBOL_NAME_PATCH\nconst symbolNameCache = new Map();\n\nasync function resolveDisplayName(symbol) {\n  const key = String(symbol || '').trim().toUpperCase();\n  if (!key) return '';\n\n  const cached = symbolNameCache.get(key);\n  if (cached && Date.now() - cached.ts < 24 * 60 * 60 * 1000) return cached.name;\n\n  let name = '';\n  if (isKoreanStockSymbol(key)) {\n    const code = cleanKoreanCode(key);\n    const list = await loadKrxList().catch(() => []);\n    name = list.find(item => String(item.code) === code)?.name || '';\n  } else {\n    const indexEntry = Object.values(INDEX_MAP).find(item => String(item.symbol).toUpperCase() === key);\n    if (indexEntry?.name) name = indexEntry.name;\n\n    if (!name) {\n      try {\n        const quote = await yahooCall(() => yahooFinance.quote(key), 1);\n        name = String(quote?.longName || quote?.shortName || quote?.displayName || '').trim();\n      } catch {\n        name = '';\n      }\n    }\n\n    if (!name) {\n      try {\n        const result = await yahooCall(() => yahooFinance.search(key, { quotesCount: 10 }), 1);\n        const exact = (result.quotes || []).find(item => String(item?.symbol || '').toUpperCase() === key);\n        name = String(exact?.longname || exact?.shortname || exact?.name || '').trim();\n      } catch {\n        name = '';\n      }\n    }\n  }\n\n  name = name || key;\n  symbolNameCache.set(key, { ts: Date.now(), name });\n  return name;\n}\n\napp.get('/api/name', async (req, res) => {\n  try {\n    const symbol = String(req.query.symbol || '').trim().toUpperCase();\n    if (!symbol) return res.status(400).json({ error: 'symbol required' });\n    return res.json({ symbol, name: await resolveDisplayName(symbol) });\n  } catch (error) {\n    return res.status(500).json({ error: error.message });\n  }\n});\n\n`;
  s = insertBefore(
    s,
    "app.get('/api/ohlcv', async (req, res) => {",
    nameRoute,
    'STOCK5_SYMBOL_NAME_PATCH',
    path,
  );

  await write(path, s);
}

async function patchApp() {
  const path = 'src/App.jsx';
  let s = await read(path);

  const loginBlock = `\n// STOCK5_SHARED_LOGIN_PATCH\nconst APP_ID = typeof window !== 'undefined'\n  ? (window.location.pathname.match(/\\/(stock5-\\d+)(?:\\/|$)/)?.[1] || 'stock5-0')\n  : 'stock5-0';\nconst PASSWORD_STORAGE_KEY = \`${'${APP_ID}'}-password\`;\nconst EMPTY_SHARED_STATE = { positions: {} };\n\nfunction Login({ onLogin }) {\n  const [password, setPassword] = useState('');\n  const [error, setError] = useState('');\n\n  const submit = async (event) => {\n    event.preventDefault();\n    setError('');\n    try {\n      const response = await fetch(apiUrl('/state'), {\n        headers: { 'x-stock5-password': password },\n      });\n      if (!response.ok) {\n        setError('비밀번호를 확인해 주세요.');\n        return;\n      }\n      const initial = await response.json();\n      localStorage.setItem(PASSWORD_STORAGE_KEY, password);\n      onLogin(password, initial);\n    } catch {\n      setError('서버에 연결하지 못했습니다.');\n    }\n  };\n\n  return (\n    <main className=\"login-page\">\n      <form className=\"login-card\" onSubmit={submit}>\n        <h1>{APP_ID}</h1>\n        <p>분류와 평균가는 서버에 저장되어 모든 기기에서 공유됩니다.</p>\n        <input\n          autoFocus\n          type=\"password\"\n          inputMode=\"numeric\"\n          placeholder=\"비밀번호\"\n          value={password}\n          onChange={(event) => setPassword(event.target.value)}\n        />\n        <button type=\"submit\">입장</button>\n        {error && <small>{error}</small>}\n      </form>\n    </main>\n  );\n}\n`;

  s = insertAfter(
    s,
    "import './stock5-0-overrides.css';\n",
    loginBlock,
    'STOCK5_SHARED_LOGIN_PATCH',
    path,
  );

  if (!s.includes('STOCK5_SHARED_APP_STATE')) {
    s = replaceOnce(
      s,
      'function App() {\n',
      `function App() {\n  // STOCK5_SHARED_APP_STATE\n  const [password, setPassword] = useState('');\n  const [sharedState, setSharedState] = useState(null);\n`,
      path,
    );
  }

  const authBlock = `  // STOCK5_SHARED_AUTH_LOGIC\n  const clearAuthentication = useCallback(() => {\n    localStorage.removeItem(PASSWORD_STORAGE_KEY);\n    setPassword('');\n    setSharedState(null);\n  }, []);\n\n  const login = useCallback((pw, initial) => {\n    setPassword(pw);\n    setSharedState({\n      ...EMPTY_SHARED_STATE,\n      ...(initial || {}),\n      positions: initial?.positions || {},\n    });\n  }, []);\n\n  const saveSharedState = useCallback(async (next) => {\n    setSharedState(next);\n    const response = await fetch(apiUrl('/state'), {\n      method: 'PUT',\n      headers: {\n        'Content-Type': 'application/json',\n        'x-stock5-password': password,\n      },\n      body: JSON.stringify(next),\n    });\n    if (response.status === 401) {\n      clearAuthentication();\n      throw new Error('비밀번호 인증이 만료되었습니다.');\n    }\n    if (!response.ok) throw new Error('공유 저장에 실패했습니다.');\n    return response.json();\n  }, [password, clearAuthentication]);\n\n  const updatePosition = useCallback((item, nextPosition) => {\n    if (!sharedState || !item?.symbol) return;\n    const key = String(item.symbol).toUpperCase();\n    const positions = { ...(sharedState.positions || {}) };\n    if (nextPosition) {\n      positions[key] = {\n        ...nextPosition,\n        symbol: key,\n        name: item.name || key,\n        updatedAt: new Date().toISOString(),\n      };\n    } else {\n      delete positions[key];\n    }\n    void saveSharedState({ ...sharedState, positions }).catch((error) => {\n      console.error('공유 상태 저장 실패:', error);\n    });\n  }, [sharedState, saveSharedState]);\n\n  useEffect(() => {\n    const pw = localStorage.getItem(PASSWORD_STORAGE_KEY);\n    if (!pw) return;\n    fetch(apiUrl('/state'), { headers: { 'x-stock5-password': pw } })\n      .then((response) => response.ok ? response.json() : Promise.reject(new Error('unauthorized')))\n      .then((data) => login(pw, data))\n      .catch(clearAuthentication);\n  }, [login, clearAuthentication]);\n\n  useEffect(() => {\n    if (!password) return undefined;\n    const timer = setInterval(() => {\n      fetch(apiUrl('/state'), { headers: { 'x-stock5-password': password } })\n        .then((response) => {\n          if (response.status === 401) {\n            clearAuthentication();\n            return null;\n          }\n          return response.ok ? response.json() : null;\n        })\n        .then((data) => {\n          if (data) setSharedState({ ...EMPTY_SHARED_STATE, ...data, positions: data.positions || {} });\n        })\n        .catch(() => {});\n    }, 10_000);\n    return () => clearInterval(timer);\n  }, [password, clearAuthentication]);\n\n`;

  s = insertBefore(
    s,
    "  useEffect(() => {\n    document.title = 'stock5-0 지수정보';",
    authBlock,
    'STOCK5_SHARED_AUTH_LOGIC',
    path,
  );

  s = s.replace('<option value="nikkei50">5. 니케이 Top 50</option>', '<option value="nikkei100">5. 니케이100</option>');

  if (!s.includes('showPositionControls={view !== \'index\'}')) {
    s = replaceOnce(
      s,
      '            showBollinger={showBollinger}\n            useStoredSelection={false}\n',
      `            showBollinger={showBollinger}\n            showPositionControls={view !== 'index'}\n            positionState={sharedState?.positions?.[String(item.symbol).toUpperCase()] || null}\n            onPositionChange={(nextPosition) => updatePosition(item, nextPosition)}\n            useStoredSelection={false}\n`,
      path,
    );
  }

  if (!s.includes('if (!sharedState) return <Login onLogin={login} />;')) {
    s = insertBefore(
      s,
      '  return (\n    <div className="app">',
      '  if (!sharedState) return <Login onLogin={login} />;\n\n',
      'if (!sharedState) return <Login onLogin={login} />;',
      path,
    );
  }

  await write(path, s);
}

async function patchChartColumn() {
  const path = 'src/components/ChartColumn.jsx';
  let s = await read(path);

  const positionDefs = `\n// STOCK5_POSITION_CONTROLS_PATCH\nconst POSITION_BUTTONS = [\n  { key: 'long-hold', label: '롱보유', tone: 'long-hold' },\n  { key: 'long-watch', label: '롱관심', tone: 'long-watch' },\n  { key: 'short-watch', label: '숏관심', tone: 'short-watch' },\n  { key: 'short-hold', label: '숏보유', tone: 'short-hold' },\n];\n\nfunction isHoldStatus(status) {\n  return status === 'long-hold' || status === 'short-hold';\n}\n`;
  s = insertAfter(
    s,
    "const NO_PRICE_LINE = { priceLineVisible: false, lastValueVisible: false };\n",
    positionDefs,
    'STOCK5_POSITION_CONTROLS_PATCH',
    path,
  );

  if (!s.includes('showPositionControls = false')) {
    s = replaceOnce(
      s,
      'export default function ChartColumn({ id, defaultSymbol, defaultName, showBollinger = false, useStoredSelection = true }) {',
      'export default function ChartColumn({ id, defaultSymbol, defaultName, showBollinger = false, useStoredSelection = true, showPositionControls = false, positionState = null, onPositionChange = null }) {',
      path,
    );
  }

  const extraState = `  // STOCK5_POSITION_STATE_PATCH\n  const [positionModalOpen, setPositionModalOpen] = useState(false);\n  const [averagePriceInput, setAveragePriceInput] = useState('');\n  const [editingHoldStatus, setEditingHoldStatus] = useState('');\n`;
  s = insertAfter(
    s,
    '  const [chartsReady, setChartsReady] = useState(false);\n',
    extraState,
    'STOCK5_POSITION_STATE_PATCH',
    path,
  );

  s = insertAfter(
    s,
    '  const cloudCanvas = useRef(null);\n',
    '  const averagePriceLineRef = useRef(null); // STOCK5_AVERAGE_PRICE_LINE_REF\n',
    'STOCK5_AVERAGE_PRICE_LINE_REF',
    path,
  );

  const nameEffect = `\n  // STOCK5_FOREIGN_NAME_PATCH\n  useEffect(() => {\n    const currentName = String(symbolName || '').trim();\n    const placeholder = !currentName\n      || currentName.startsWith('NASDAQ100 ')\n      || currentName.startsWith('니케이 Top ')\n      || currentName.startsWith('니케이100 ')\n      || currentName.startsWith('NIKKEI100 ');\n    const foreignStock = Boolean(symbol) && !String(symbol).startsWith('^')\n      && !isKoreanSymbol(symbol) && !String(symbol).includes('=');\n    if (!placeholder || !foreignStock) return undefined;\n\n    const controller = new AbortController();\n    fetch(apiUrl(\`/name?symbol=${'${encodeURIComponent(symbol)}'}\`), { signal: controller.signal })\n      .then((response) => response.ok ? response.json() : null)\n      .then((payload) => {\n        const name = String(payload?.name || '').trim();\n        if (name && name.toUpperCase() !== String(symbol).toUpperCase()) setSymbolName(name);\n      })\n      .catch((error) => {\n        if (error?.name !== 'AbortError') console.warn('종목명 조회 실패:', symbol, error);\n      });\n    return () => controller.abort();\n  }, [symbol, symbolName]);\n`;
  s = insertAfter(
    s,
    "  useEffect(() => {\n    symbolRef.current = symbol;\n    timeZoneRef.current = symbolTimeZone(symbol);\n  }, [symbol]);\n",
    nameEffect,
    'STOCK5_FOREIGN_NAME_PATCH',
    path,
  );

  const priceLineEffect = `\n  // STOCK5_AVERAGE_PRICE_LINE_PATCH\n  useEffect(() => {\n    const candleSeries = ser.current.candle;\n    if (!chartsReady || !candleSeries) return undefined;\n\n    if (averagePriceLineRef.current) {\n      try { candleSeries.removePriceLine(averagePriceLineRef.current); } catch {}\n      averagePriceLineRef.current = null;\n    }\n\n    const price = Number(positionState?.averagePrice);\n    if (Number.isFinite(price) && price > 0) {\n      try {\n        averagePriceLineRef.current = candleSeries.createPriceLine({\n          price,\n          color: '#dc2626',\n          lineWidth: 2,\n          lineStyle: 2,\n          axisLabelVisible: true,\n          title: '평균가',\n        });\n      } catch (error) {\n        console.warn('평균가 라인 생성 실패:', error);\n      }\n    }\n\n    return () => {\n      if (averagePriceLineRef.current) {\n        try { candleSeries.removePriceLine(averagePriceLineRef.current); } catch {}\n        averagePriceLineRef.current = null;\n      }\n    };\n  }, [chartsReady, positionState?.averagePrice, symbol]);\n`;
  s = insertAfter(
    s,
    "  useEffect(() => {\n    ser.current.bollingerUpper?.applyOptions({ visible: showBollinger });\n    ser.current.bollingerMiddle?.applyOptions({ visible: showBollinger });\n    ser.current.bollingerLower?.applyOptions({ visible: showBollinger });\n  }, [showBollinger]);\n",
    priceLineEffect,
    'STOCK5_AVERAGE_PRICE_LINE_PATCH',
    path,
  );

  const handlers = `  // STOCK5_POSITION_HANDLERS_PATCH\n  const positionStatus = positionState?.status || '';\n  const holdingSelected = isHoldStatus(positionStatus);\n\n  const emitPositionChange = useCallback((next) => {\n    try {\n      const result = onPositionChange?.(next);\n      if (result && typeof result.catch === 'function') result.catch((error) => console.error(error));\n    } catch (error) {\n      console.error('포지션 저장 실패:', error);\n    }\n  }, [onPositionChange]);\n\n  const openAveragePriceModal = useCallback((status = positionStatus) => {\n    if (!isHoldStatus(status)) return;\n    setEditingHoldStatus(status);\n    setAveragePriceInput(Number.isFinite(Number(positionState?.averagePrice)) ? String(positionState.averagePrice) : '');\n    setPositionModalOpen(true);\n  }, [positionStatus, positionState?.averagePrice]);\n\n  const handlePositionButton = useCallback((status) => {\n    if (isHoldStatus(status)) {\n      if (positionStatus !== status) {\n        emitPositionChange({ status, averagePrice: null });\n      }\n      openAveragePriceModal(status);\n      return;\n    }\n\n    if (positionStatus === status) {\n      emitPositionChange(null);\n    } else {\n      emitPositionChange({ status, averagePrice: null });\n    }\n  }, [positionStatus, emitPositionChange, openAveragePriceModal]);\n\n  const saveAveragePrice = useCallback((event) => {\n    event?.preventDefault?.();\n    const price = Number(String(averagePriceInput).replaceAll(',', '').trim());\n    if (!Number.isFinite(price) || price <= 0) return;\n    const status = isHoldStatus(editingHoldStatus) ? editingHoldStatus : positionStatus;\n    if (!isHoldStatus(status)) return;\n    emitPositionChange({ status, averagePrice: price });\n    setPositionModalOpen(false);\n  }, [averagePriceInput, editingHoldStatus, positionStatus, emitPositionChange]);\n\n  const deleteAveragePrice = useCallback(() => {\n    const status = isHoldStatus(editingHoldStatus) ? editingHoldStatus : positionStatus;\n    if (isHoldStatus(status)) emitPositionChange({ status, averagePrice: null });\n    setAveragePriceInput('');\n    setPositionModalOpen(false);\n  }, [editingHoldStatus, positionStatus, emitPositionChange]);\n\n`;
  s = insertBefore(
    s,
    '  // ─── Render ──────────────────────────────────────────\n',
    handlers,
    'STOCK5_POSITION_HANDLERS_PATCH',
    path,
  );

  const controls = `            {showPositionControls && (\n              <div className=\"position-mini-controls\" aria-label=\"종목 분류\">\n                <button\n                  type=\"button\"\n                  className=\"position-mini-btn position-input-btn\"\n                  onClick={() => openAveragePriceModal()}\n                  disabled={!holdingSelected}\n                  title={holdingSelected ? '평균가 입력/수정' : '롱보유 또는 숏보유를 먼저 선택하세요'}\n                >\n                  입력\n                </button>\n                {POSITION_BUTTONS.map((button) => (\n                  <button\n                    key={button.key}\n                    type=\"button\"\n                    className={\`position-mini-btn ${'${button.tone}'}${'${positionStatus === button.key ? \' active\' : \'\'}'}\`}\n                    aria-pressed={positionStatus === button.key}\n                    onClick={() => handlePositionButton(button.key)}\n                  >\n                    {button.label}\n                  </button>\n                ))}\n              </div>\n            )}\n`;
  s = insertAfter(
    s,
    '            {loading && <span className="loading-dot">●</span>}\n',
    controls,
    'position-mini-controls',
    path,
  );

  const modal = `      {positionModalOpen && (\n        <div className=\"position-modal-backdrop\" onMouseDown={() => setPositionModalOpen(false)}>\n          <form\n            className=\"position-price-modal\"\n            onSubmit={saveAveragePrice}\n            onMouseDown={(event) => event.stopPropagation()}\n          >\n            <h3>{editingHoldStatus === 'short-hold' ? '숏보유' : '롱보유'} 평균가</h3>\n            <p>{symbolName || symbol} <span>{symbol}</span></p>\n            <input\n              autoFocus\n              type=\"number\"\n              inputMode=\"decimal\"\n              min=\"0\"\n              step=\"any\"\n              placeholder=\"평균가 입력\"\n              value={averagePriceInput}\n              onChange={(event) => setAveragePriceInput(event.target.value)}\n            />\n            <div className=\"position-modal-actions\">\n              <button type=\"submit\" className=\"position-save-btn\">저장</button>\n              <button type=\"button\" className=\"position-delete-btn\" onClick={deleteAveragePrice}>삭제</button>\n              <button type=\"button\" onClick={() => setPositionModalOpen(false)}>취소</button>\n            </div>\n          </form>\n        </div>\n      )}\n\n`;
  s = insertBefore(
    s,
    '      <div className="ma-legend">\n',
    modal,
    'position-modal-backdrop',
    path,
  );

  await write(path, s);
}

async function patchPresets() {
  const path = 'src/marketPresets.js';
  let s = await read(path);

  const nikkeiSymbols = `7203.T 6758.T 6861.T 9984.T 8306.T 8035.T 6902.T 7267.T 9432.T 9983.T 4502.T 6098.T 4063.T 8031.T 8058.T 6367.T 6954.T 6501.T 6503.T 7269.T 7741.T 7751.T 7974.T 8001.T 8002.T 8766.T 8801.T 9020.T 9022.T 9433.T 9434.T 4661.T 4901.T 5108.T 5713.T 5802.T 6301.T 6326.T 6857.T 6971.T 6976.T 7733.T 8005.T 8411.T 8591.T 8604.T 8802.T 8830.T 9613.T 1605.T 1801.T 1802.T 1812.T 1925.T 1928.T 2502.T 2914.T 3382.T 3402.T 3407.T 4452.T 4503.T 4507.T 4519.T 4523.T 4568.T 5020.T 5201.T 5332.T 5333.T 5401.T 5406.T 5411.T 5706.T 5711.T 5801.T 5803.T 6113.T 6146.T 6305.T 6383.T 6504.T 6594.T 6645.T 6701.T 6702.T 6724.T 6762.T 6841.T 6981.T 6988.T 7011.T 7012.T 7201.T 7202.T 7270.T 7731.T 7832.T 8053.T 9101.T`;

  if (!s.includes('const NIKKEI100 =')) {
    const match = s.match(/const NIKKEI50 = `[^`]*`\.split\(' '\);/s);
    if (!match) throw new Error(`${path}: NIKKEI50 list not found`);
    s = s.replace(match[0], `const NIKKEI100 = \`${nikkeiSymbols}\`.split(' '); // STOCK5_NIKKEI100_PATCH`);
  }

  s = s.replace(
    /nikkei50:\s*\{\s*label:\s*'니케이 Top 50',\s*items:\s*makeItems\(NIKKEI50,\s*'니케이 Top 50',\s*50\),\s*\}/s,
    `nikkei100: {\n    label: '니케이100',\n    items: makeItems(NIKKEI100, '니케이100', 100),\n  }`,
  );

  await write(path, s);
}

async function patchCss() {
  const path = 'src/index.css';
  let s = await read(path);
  if (s.includes('STOCK5_POSITION_STYLE_PATCH')) return;

  s += `\n\n/* STOCK5_POSITION_STYLE_PATCH */\n.login-page { min-height: 100vh; display: grid; place-items: center; padding: 20px; background: var(--bg); }\n.login-card { width: min(360px, calc(100vw - 32px)); background: #fff; padding: 28px; border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); display: grid; gap: 12px; }\n.login-card h1 { font-size: 20px; }\n.login-card p { color: var(--muted); font-size: 12px; }\n.login-card input { width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 6px; font: inherit; }\n.login-card button { border: 1px solid var(--accent); border-radius: 6px; padding: 9px 12px; background: var(--accent); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }\n.login-card small { color: #dc2626; }\n\n.position-mini-controls { display: inline-flex; align-items: center; gap: 2px; flex-wrap: wrap; margin-left: 2px; }\n.position-mini-btn { appearance: none; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; color: #4b5563; padding: 2px 5px; font: 700 9px/1.35 Inter, sans-serif; cursor: pointer; white-space: nowrap; }\n.position-mini-btn:hover { border-color: #9ca3af; }\n.position-mini-btn:disabled { cursor: default; opacity: .4; }\n.position-mini-btn.long-hold.active { background: #dc2626; border-color: #dc2626; color: #fff; }\n.position-mini-btn.long-watch.active { background: rgba(220, 38, 38, .13); border-color: rgba(220, 38, 38, .55); color: #b91c1c; }\n.position-mini-btn.short-watch.active { background: rgba(37, 99, 235, .13); border-color: rgba(37, 99, 235, .55); color: #1d4ed8; }\n.position-mini-btn.short-hold.active { background: #2563eb; border-color: #2563eb; color: #fff; }\n.position-input-btn { background: #fff !important; color: #374151 !important; }\n\n.position-modal-backdrop { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 18px; background: rgba(15, 23, 42, .35); }\n.position-price-modal { width: min(340px, 100%); background: #fff; border: 1px solid #dbe1ea; border-radius: 10px; padding: 18px; box-shadow: 0 18px 50px rgba(0,0,0,.22); display: grid; gap: 10px; }\n.position-price-modal h3 { font-size: 15px; }\n.position-price-modal p { color: var(--muted); font-size: 12px; }\n.position-price-modal p span { margin-left: 4px; }\n.position-price-modal input { width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 9px 10px; font: inherit; }\n.position-modal-actions { display: flex; justify-content: flex-end; gap: 6px; }\n.position-modal-actions button { border: 1px solid #cbd5e1; border-radius: 5px; background: #fff; padding: 6px 10px; font: inherit; cursor: pointer; }\n.position-modal-actions .position-save-btn { background: #111827; border-color: #111827; color: #fff; }\n.position-modal-actions .position-delete-btn { color: #dc2626; border-color: #fecaca; }\n`;

  await write(path, s);
}

async function patchGitignore() {
  const path = '.gitignore';
  let s = await read(path);
  if (!s.split(/\r?\n/).includes('data/')) {
    s = `${s.trimEnd()}\n\n# stock5-0 server-side shared state\ndata/\n`;
    await write(path, s);
  }
}

async function main() {
  await patchServer();
  await patchApp();
  await patchChartColumn();
  await patchPresets();
  await patchCss();
  await patchGitignore();
  console.log('OK: stock5-0 shared positions/password/name/Nikkei100 patch applied');
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
