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

function replaceRegex(text, regex, replacement, label) {
  if (!regex.test(text)) throw new Error(`${label}: target not found`);
  return text.replace(regex, replacement);
}

async function patchServer() {
  const path = 'scripts/server.js';
  let s = await read(path);

  const blockV2 = `
// STOCK5_LIVE_TOP100_SERVER_PATCH_V2
const NAVER_TOP100_API_URL =
  'https://stock.naver.com/api/stockSecurity/individual-stocks/v3/domestic';

async function fetchLiveTop100Page(market, pageIndex) {
  const params = new URLSearchParams({
    listingType: 'marketCapDesc',
    exchangeType: 'krx',
    marketType: market === 'kosdaq' ? 'KOSDAQ' : 'KOSPI',
    index: String(pageIndex),
    size: '50',
  });

  const response = await fetch(\`\${NAVER_TOP100_API_URL}?\${params.toString()}\`, {
    headers: {
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0',
      'Cache-Control': 'no-cache',
    },
  });

  if (!response.ok) {
    throw new Error(\`Naver Top100 responded \${response.status}\`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function loadLiveTop100(market) {
  const suffix = market === 'kosdaq' ? 'KQ' : 'KS';
  const seen = new Set();
  const items = [];

  // 실시간 시총순위가 페이지 조회 사이에 변하면 50위/51위 같은 경계 종목이
  // 중복되어 99개가 될 수 있다. 그래서 100개가 찰 때까지 최대 5페이지를
  // 순서대로 추가 조회하고 종목코드 기준으로 중복 제거한다.
  for (let pageIndex = 0; pageIndex < 5 && items.length < 100; pageIndex += 1) {
    const rows = await fetchLiveTop100Page(market, pageIndex);

    for (const row of rows) {
      const code = String(row?.itemCode || '').trim();
      const name = String(row?.itemName || row?.stockName || row?.name || '').trim();

      if (!/^\\d{6}$/.test(code) || !name || seen.has(code)) continue;

      seen.add(code);
      items.push({
        code,
        symbol: \`\${code}.\${suffix}\`,
        name,
      });

      if (items.length >= 100) break;
    }

    if (!rows.length) break;
  }

  if (items.length < 100) {
    throw new Error(\`Top100 expected 100 unique rows, received \${items.length}\`);
  }

  return items.slice(0, 100).map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
}

app.get('/api/top100', async (req, res) => {
  try {
    const market = String(req.query.market || '').trim().toLowerCase();
    if (market !== 'kospi' && market !== 'kosdaq') {
      return res.status(400).json({ error: 'market must be kospi or kosdaq' });
    }

    const items = await loadLiveTop100(market);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.json({
      market,
      count: items.length,
      fetchedAt: new Date().toISOString(),
      items,
    });
  } catch (error) {
    console.error('Top100 error:', error.message);
    return res.status(502).json({ error: error.message });
  }
});

`;

  const oldV1 = /\/\/ STOCK5_LIVE_TOP100_SERVER_PATCH\n[\s\S]*?\napp\.get\('\/api\/top100', async \(req, res\) => \{[\s\S]*?\n\}\);\n\n/;
  if (s.includes('STOCK5_LIVE_TOP100_SERVER_PATCH_V2')) {
    // already applied
  } else if (oldV1.test(s)) {
    s = s.replace(oldV1, blockV2.trimStart());
  } else {
    s = insertBefore(
      s,
      "app.get('/api/search', async (req, res) => {",
      blockV2,
      'STOCK5_LIVE_TOP100_SERVER_PATCH_V2',
      path,
    );
  }

  await write(path, s);
}

async function patchApp() {
  const path = 'src/App.jsx';
  let s = await read(path);

  // 앱 쪽 V1 패치는 그대로 재사용한다.
  if (!s.includes('STOCK5_LIVE_TOP100_APP_PATCH')) {
    s = insertAfter(
      s,
      `function koreanCode(symbol) {
  return String(symbol || '').match(/^(\\d{6})\\.(KS|KQ)$/)?.[1] || null;
}
`,
      `
const KOREAN_TOP100_VIEWS = new Set(['kospi100', 'kosdaq100']); // STOCK5_LIVE_TOP100_APP_PATCH
`,
      'STOCK5_LIVE_TOP100_APP_PATCH',
      path,
    );

    s = insertAfter(
      s,
      `  const [resolvedNames, setResolvedNames] = useState({});
`,
      `  const [liveKoreanGroups, setLiveKoreanGroups] = useState({
    kospi100: null,
    kosdaq100: null,
  });
  const [liveTop100Loading, setLiveTop100Loading] = useState({
    kospi100: true,
    kosdaq100: true,
  });
  const [liveTop100Error, setLiveTop100Error] = useState({
    kospi100: '',
    kosdaq100: '',
  });
  const top100RequestSeqRef = useRef({ kospi100: 0, kosdaq100: 0 });
`,
      'top100RequestSeqRef',
      path,
    );

    const oldSource = `  const sourceItems = view === 'index'
    ? INDEX_ITEMS
    : GROUPS[view].items;
`;

    const newSource = `  const loadLiveTop100 = useCallback(async (groupKey, signal) => {
    if (!KOREAN_TOP100_VIEWS.has(groupKey)) return [];

    const requestId = (top100RequestSeqRef.current[groupKey] || 0) + 1;
    top100RequestSeqRef.current[groupKey] = requestId;
    const market = groupKey === 'kosdaq100' ? 'kosdaq' : 'kospi';

    setLiveTop100Loading(current => ({ ...current, [groupKey]: true }));
    setLiveTop100Error(current => ({ ...current, [groupKey]: '' }));

    try {
      const response = await fetch(
        apiUrl(\`/top100?market=\${market}&_=\${Date.now()}\`),
        { signal, cache: 'no-store' },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || \`Top100 조회 실패 (\${response.status})\`);
      }

      const items = Array.isArray(payload?.items)
        ? payload.items
            .filter(item => item?.symbol && item?.name)
            .slice(0, 100)
            .map((item, index) => ({
              symbol: String(item.symbol),
              name: String(item.name),
              rank: Number(item.rank) || index + 1,
            }))
        : [];

      if (items.length !== 100) {
        throw new Error(\`Top100 데이터가 \${items.length}개입니다.\`);
      }

      if (top100RequestSeqRef.current[groupKey] === requestId) {
        setLiveKoreanGroups(current => ({ ...current, [groupKey]: items }));
      }
      return items;
    } catch (error) {
      if (error?.name !== 'AbortError' && top100RequestSeqRef.current[groupKey] === requestId) {
        setLiveTop100Error(current => ({
          ...current,
          [groupKey]: error?.message || 'Top100 조회 실패',
        }));
      }
      return [];
    } finally {
      if (top100RequestSeqRef.current[groupKey] === requestId) {
        setLiveTop100Loading(current => ({ ...current, [groupKey]: false }));
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadLiveTop100('kospi100', controller.signal);
    void loadLiveTop100('kosdaq100', controller.signal);
    return () => controller.abort();
  }, [loadLiveTop100]);

  const isKoreanTop100View = KOREAN_TOP100_VIEWS.has(view);
  const sourceItems = view === 'index'
    ? INDEX_ITEMS
    : isKoreanTop100View
      ? (liveKoreanGroups[view] || [])
      : GROUPS[view].items;
`;

    s = replaceOnce(s, oldSource, newSource, path);

    const oldHandle = `  const handleViewChange = (event) => {
    setView(event.target.value);
    // ChartColumn의 localStorage가 프리셋 종목을 덮어쓰지 않도록
    // 그룹 전환 시 새로운 storage key로 다시 마운트한다.
    setPresetVersion(version => version + 1);
  };
`;

    const newHandle = `  const handleViewChange = (event) => {
    const nextView = event.target.value;
    setView(nextView);
    setPresetVersion(version => version + 1);

    if (KOREAN_TOP100_VIEWS.has(nextView)) {
      setLiveKoreanGroups(current => ({ ...current, [nextView]: null }));
      void loadLiveTop100(nextView);
    }
  };
`;

    s = replaceOnce(s, oldHandle, newHandle, path);

    const oldDashboard = `      <div className="dashboard-grid">
        {selectedItems.map((item, index) => {
`;
    const newDashboard = `      <div className="dashboard-grid">
        {isKoreanTop100View && liveTop100Loading[view] && selectedItems.length === 0 && (
          <div className="top100-status">현재 시가총액 Top 100 불러오는 중...</div>
        )}
        {isKoreanTop100View && !liveTop100Loading[view] && liveTop100Error[view] && selectedItems.length === 0 && (
          <div className="top100-status error">Top 100 조회 오류: {liveTop100Error[view]}</div>
        )}
        {selectedItems.map((item, index) => {
`;
    s = replaceOnce(s, oldDashboard, newDashboard, path);
  }

  await write(path, s);
}

async function patchCss() {
  const path = 'src/index.css';
  let s = await read(path);
  if (!s.includes('STOCK5_LIVE_TOP100_STYLE_PATCH')) {
    s += `

/* STOCK5_LIVE_TOP100_STYLE_PATCH */
.top100-status {
  grid-column: 1 / -1;
  padding: 24px;
  text-align: center;
  color: #64748b;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-weight: 600;
}
.top100-status.error {
  color: #b91c1c;
  background: #fef2f2;
  border-color: #fecaca;
}
`;
    await write(path, s);
  }
}

async function main() {
  await patchServer();
  await patchApp();
  await patchCss();
  console.log('OK: live Top100 V2 - collect 100 unique rows across extra pages');
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
