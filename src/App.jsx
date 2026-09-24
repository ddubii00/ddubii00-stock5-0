import { useCallback, useEffect, useMemo, useState } from 'react';
import ChartColumn from './components/ChartColumn';
import { apiUrl } from './api';
import { GROUPS, INDEX_ITEMS } from './marketPresets';
import './index.css';
import './stock5-0-overrides.css';

function formatFixed(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatSignedFixed(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatFixed(n, digits)}`;
}

function formatSignedPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function timeParts(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const weekday = parts.find(part => part.type === 'weekday')?.value;
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const minute = Number(parts.find(part => part.type === 'minute')?.value);
  return { weekday, minutes: hour * 60 + minute };
}

function isWeekday(weekday) {
  return weekday !== 'Sat' && weekday !== 'Sun';
}

function isKrxUpdateWindow() {
  const { weekday, minutes } = timeParts('Asia/Seoul');
  return isWeekday(weekday) && minutes >= 9 * 60 && minutes <= 15 * 60 + 31;
}

function isUsOpen() {
  const { weekday, minutes } = timeParts('America/New_York');
  return isWeekday(weekday) && minutes >= 9 * 60 + 30 && minutes <= 16 * 60;
}

function koreanCode(symbol) {
  return String(symbol || '').match(/^(\d{6})\.(KS|KQ)$/)?.[1] || null;
}

function App() {
  const [view, setView] = useState('index');
  const [presetVersion, setPresetVersion] = useState(0);
  const [marketSummary, setMarketSummary] = useState({
    kospi: null,
    kosdaq: null,
    nasdaq: null,
    sp500: null,
    usdKrw: null,
  });
  const [showBollinger, setShowBollinger] = useState(false);
  const [resolvedNames, setResolvedNames] = useState({});

  useEffect(() => {
    document.title = 'stock5-0 지수정보';
  }, []);

  const sourceItems = view === 'index'
    ? INDEX_ITEMS
    : GROUPS[view].items;

  const selectedItems = useMemo(
    () => sourceItems.map((item) => {
      const code = koreanCode(item.symbol);
      if (!code) return item;
      const resolved = resolvedNames[code];
      return resolved ? { ...item, name: resolved } : item;
    }),
    [sourceItems, resolvedNames],
  );

  const handleViewChange = (event) => {
    setView(event.target.value);
    // ChartColumn의 localStorage가 프리셋 종목을 덮어쓰지 않도록
    // 그룹 전환 시 새로운 storage key로 다시 마운트한다.
    setPresetVersion(version => version + 1);
  };

  const fetchQuote = useCallback(async (symbol, signal) => {
    const response = await fetch(
      apiUrl(`/quote?symbol=${encodeURIComponent(symbol)}`),
      { signal },
    );
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('application/json')) return null;

    const data = await response.json();
    return data && Number.isFinite(Number(data.price)) ? data : null;
  }, []);

  const refreshMarketSummary = useCallback(async (signal) => {
    const [kospi, kosdaq, nasdaq, sp500, usdKrw] = await Promise.all([
      fetchQuote('^KS11', signal).catch(() => null),
      fetchQuote('^KQ11', signal).catch(() => null),
      fetchQuote('^IXIC', signal).catch(() => null),
      fetchQuote('^GSPC', signal).catch(() => null),
      fetchQuote('KRW=X', signal).catch(() => null),
    ]);

    setMarketSummary((current) => ({
      kospi: kospi || current.kospi,
      kosdaq: kosdaq || current.kosdaq,
      nasdaq: nasdaq || current.nasdaq,
      sp500: sp500 || current.sp500,
      usdKrw: usdKrw || current.usdKrw,
    }));
  }, [fetchQuote]);

  useEffect(() => {
    const controller = new AbortController();
    const update = () => refreshMarketSummary(controller.signal).catch(() => {});

    update();
    let timer = null;

    if (isKrxUpdateWindow() || isUsOpen()) {
      timer = setInterval(() => {
        if (!isKrxUpdateWindow() && !isUsOpen()) {
          clearInterval(timer);
          timer = null;
          return;
        }
        update();
      }, isKrxUpdateWindow() ? 1000 : 3000);
    }

    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [refreshMarketSummary]);

  // KOSPI100 / KOSDAQ100 프리셋의 임시 이름을 실제 종목명으로 바꾼다.
  // 기존 서버의 /api/search를 그대로 이용하므로 server.js 수정이 필요 없다.
  useEffect(() => {
    const candidates = sourceItems
      .map(item => ({
        symbol: item.symbol,
        code: koreanCode(item.symbol),
      }))
      .filter(item => item.code && !resolvedNames[item.code]);

    if (!candidates.length) return undefined;

    const controller = new AbortController();
    let cancelled = false;
    const resolved = {};
    let cursor = 0;
    const workerCount = Math.min(6, candidates.length);

    const worker = async () => {
      while (!cancelled) {
        const index = cursor;
        cursor += 1;
        if (index >= candidates.length) return;

        const target = candidates[index];

        try {
          const response = await fetch(
            apiUrl(`/search?q=${encodeURIComponent(target.code)}`),
            { signal: controller.signal },
          );

          if (!response.ok) continue;
          const rows = await response.json();
          if (!Array.isArray(rows)) continue;

          const exact = rows.find(
            row => String(row?.symbol || '').replace(/\.(KS|KQ)$/, '') === target.code,
          );

          if (exact?.name) {
            resolved[target.code] = exact.name;
          }
        } catch (error) {
          if (error?.name !== 'AbortError') {
            console.warn(`종목명 조회 실패 [${target.code}]`, error);
          }
        }
      }
    };

    Promise.all(
      Array.from({ length: workerCount }, () => worker()),
    ).then(() => {
      if (!cancelled && Object.keys(resolved).length) {
        setResolvedNames(current => ({
          ...current,
          ...resolved,
        }));
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sourceItems, resolvedNames]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="market-summary" aria-label="시장 요약">
          {marketSummary.usdKrw && (
            <span className={`market-item ${marketSummary.usdKrw.change >= 0 ? 'up' : 'down'}`}>
              달러/원
              <strong className="market-price">
                {formatFixed(marketSummary.usdKrw.price, 2)}
              </strong>
              {Number.isFinite(marketSummary.usdKrw.changePct)
                && Number.isFinite(marketSummary.usdKrw.change) && (
                <span className="market-change market-change-fixed">
                  ({formatSignedPercent(marketSummary.usdKrw.changePct)}, {formatSignedFixed(marketSummary.usdKrw.change, 2)})
                </span>
              )}
            </span>
          )}

          {marketSummary.kospi && (
            <span className={`market-item ${marketSummary.kospi.change >= 0 ? 'up' : 'down'}`}>
              KOSPI
              <strong className="market-price">
                {formatFixed(marketSummary.kospi.price, 2)}
              </strong>
              {Number.isFinite(marketSummary.kospi.changePct)
                && Number.isFinite(marketSummary.kospi.change) && (
                <span className="market-change market-change-fixed">
                  ({formatSignedPercent(marketSummary.kospi.changePct)}, {formatSignedFixed(marketSummary.kospi.change, 2)})
                </span>
              )}
            </span>
          )}

          {marketSummary.kosdaq && (
            <span className={`market-item ${marketSummary.kosdaq.change >= 0 ? 'up' : 'down'}`}>
              KOSDAQ
              <strong className="market-price">
                {formatFixed(marketSummary.kosdaq.price, 2)}
              </strong>
              {Number.isFinite(marketSummary.kosdaq.changePct)
                && Number.isFinite(marketSummary.kosdaq.change) && (
                <span className="market-change market-change-fixed">
                  ({formatSignedPercent(marketSummary.kosdaq.changePct)}, {formatSignedFixed(marketSummary.kosdaq.change, 2)})
                </span>
              )}
            </span>
          )}

          {marketSummary.nasdaq && (
            <span className={`market-item ${marketSummary.nasdaq.change >= 0 ? 'up' : 'down'}`}>
              나스닥
              <strong className="market-price">
                {formatFixed(marketSummary.nasdaq.price, 2)}
              </strong>
              {Number.isFinite(marketSummary.nasdaq.changePct)
                && Number.isFinite(marketSummary.nasdaq.change) && (
                <span className="market-change market-change-fixed">
                  ({formatSignedPercent(marketSummary.nasdaq.changePct)}, {formatSignedFixed(marketSummary.nasdaq.change, 2)})
                </span>
              )}
            </span>
          )}

          {marketSummary.sp500 && (
            <span className={`market-item ${marketSummary.sp500.change >= 0 ? 'up' : 'down'}`}>
              S&amp;P500
              <strong className="market-price">
                {formatFixed(marketSummary.sp500.price, 2)}
              </strong>
              {Number.isFinite(marketSummary.sp500.changePct)
                && Number.isFinite(marketSummary.sp500.change) && (
                <span className="market-change market-change-fixed">
                  ({formatSignedPercent(marketSummary.sp500.changePct)}, {formatSignedFixed(marketSummary.sp500.change, 2)})
                </span>
              )}
            </span>
          )}
        </div>

        <div className="index-view-control">
          <select
            id="index-view"
            aria-label="차트 그룹 선택"
            value={view}
            onChange={handleViewChange}
          >
            <option value="index">1. 지수</option>
            <option value="kospi100">2. KOSPI100</option>
            <option value="kosdaq100">3. KOSDAQ100</option>
            <option value="nasdaq100">4. NASDAQ100</option>
            <option value="nikkei50">5. 니케이 Top 50</option>
          </select>
        </div>

        <button
          type="button"
          className={`header-bb-button${showBollinger ? ' active' : ''}`}
          onClick={() => setShowBollinger(visible => !visible)}
          title="전체 캔들차트 볼린저밴드 표시"
          aria-pressed={showBollinger}
        >
          BB
        </button>
      </header>

      <div className="dashboard-grid">
        {selectedItems.map((item, index) => (
          <ChartColumn
            key={`${view}-${presetVersion}-${item.symbol}-${item.name}`}
            id={`preset-${view}-${presetVersion}-${index + 1}`}
            defaultSymbol={item.symbol}
            defaultName={item.name}
            showBollinger={showBollinger}
          />
        ))}
      </div>
    </div>
  );
}

export default App;
