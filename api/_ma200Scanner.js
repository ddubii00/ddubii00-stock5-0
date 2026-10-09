import YahooFinance from 'yahoo-finance2';
import { loadScanUniverse } from './_scanUniverse.js';
import { SCAN_MARKETS, analyzeMa200History, normalizeDailyHistory, scanReference } from '../src/utils/ma200Scan.js';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const HISTORY_LIMIT = 1250; // Enough daily closes for 201 weekly bars, including holidays.
const SCAN_VERSION = 2;
const CACHE_MS = 15 * 60 * 1000;

export async function fetchScanHistory(symbol, market, limit = HISTORY_LIMIT) {
  const signal = AbortSignal.timeout(20000);
  if (['kospi', 'kosdaq'].includes(market) && !symbol.startsWith('^')) {
    const code = symbol.replace(/\.(KS|KQ)$/, '');
    const count = Math.min(limit + 300, 2500);
    const response = await fetch(`https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(code)}&timeframe=day&count=${count}&requestType=0`, {
      signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ko-KR,ko;q=0.9' },
    });
    if (!response.ok) throw new Error(`일봉 조회 실패 (${response.status})`);
    return [...(await response.text()).matchAll(/item data="([^"]+)"/g)].map(match => {
      const fields = match[1].split('|');
      return { date: fields[0], close: Number(fields[4]) };
    }).slice(-limit);
  }
  const period1 = new Date(Date.now() - (limit * 2.5 + 20) * 86400000);
  const data = await yahoo.chart(symbol, { period1, interval: '1d' }, { fetchOptions: { signal } });
  const timeZone = market === 'japan' ? 'Asia/Tokyo' : ['kospi', 'kosdaq'].includes(market) ? 'Asia/Seoul' : 'America/New_York';
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (data.quotes || []).filter(row => row.close != null).map(row => ({
    time: formatter.format(new Date(row.date)), close: row.close,
  })).slice(-limit);
}

export async function fetchScanWeeklyHistory(symbol, market, limit = 300) {
  const signal = AbortSignal.timeout(20000);
  let rows;
  if (['kospi', 'kosdaq'].includes(market)) {
    const code = symbol.replace(/\.(KS|KQ)$/, '');
    const response = await fetch(`https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(code)}&timeframe=week&count=${limit}&requestType=0`, {
      signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ko-KR,ko;q=0.9' },
    });
    if (!response.ok) throw new Error(`주봉 추가 조회 실패 (${response.status})`);
    rows = [...(await response.text()).matchAll(/item data="([^"]+)"/g)].map(match => {
      const fields = match[1].split('|');
      return { time: fields[0], close: Number(fields[4]) };
    });
  } else {
    const period1 = new Date(Date.now() - (limit * 7 + 30) * 86400000);
    const data = await yahoo.chart(symbol, { period1, interval: '1wk' }, { fetchOptions: { signal } });
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: market === 'japan' ? 'Asia/Tokyo' : 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit' });
    rows = (data.quotes || []).filter(row => row.close != null).map(row => ({
      time: formatter.format(new Date(row.date)), close: row.close,
    }));
  }
  if (!rows.length) throw new Error('주봉 추가 조회 결과가 비어 있습니다.');
  return normalizeDailyHistory(rows).slice(-limit);
}

export function createMa200Scanner({ loadUniverse = loadScanUniverse, loadHistory = fetchScanHistory,
  loadWeeklyHistory = fetchScanWeeklyHistory,
  readCheckpoint = async () => null, writeCheckpoint = async () => {}, now = Date.now, concurrency = 2 } = {}) {
  let state = null;
  let runner = null;
  let restore = null;
  let writes = Promise.resolve();
  let lastSaved = 0;
  const isoNow = () => new Date(now()).toISOString();
  const checkpoint = (force = false) => {
    if (!force && now() - lastSaved < 5000) return writes;
    lastSaved = now();
    const copy = JSON.parse(JSON.stringify(state));
    writes = writes.then(() => writeCheckpoint(copy)).catch(error => { state.persistenceError = error.message; });
    return writes;
  };
  async function restoreOnce() {
    if (!restore) restore = Promise.resolve().then(readCheckpoint).then(saved => {
      if ([1, SCAN_VERSION].includes(saved?.version) && Array.isArray(saved.markets) && saved.markets.length === 4
        && saved.markets.every(m => Object.hasOwn(SCAN_MARKETS, m.key) && Array.isArray(m.rows))) {
        state = saved;
        if (state.status === 'running') state.status = 'interrupted';
        if (saved.version === 1) {
          // Recheck only old weekly-short exclusions when the reference session
          // still matches; keep other results instead of rescanning every stock.
          state.status = 'interrupted';
          for (const market of state.markets) {
            market.rows = market.rows.filter(row => row.week?.status !== 'short-history');
            market.completed = market.rows.length;
          }
        }
      }
    }).catch(error => { state = { status: 'restore-error', persistenceError: error.message, markets: [] }; });
    await restore;
  }
  async function run(job, previous) {
    // Only two history requests at once, including the market reference histories.
    const activeMarkets = job.markets;
    let marketCursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (marketCursor < activeMarkets.length) {
        const market = activeMarkets[marketCursor++];
        try {
          const universe = await loadUniverse(market.key);
          const unique = new Map(universe.items.map(item => [item.symbol, item]));
          if (!unique.size || unique.size !== universe.items.length) throw new Error('전체 종목 목록이 비어 있거나 중복되었습니다.');
          market.items = [...unique.values()];
          market.total = market.items.length;
          market.source = universe.source;
          market.sourceDate = universe.sourceDate;
          market.reference = scanReference(await loadHistory(SCAN_MARKETS[market.key].benchmark, market.key, 30));
          const saved = previous?.status === 'interrupted' && previous.markets.find(m => m.key === market.key);
          if (saved?.reference?.day.latest === market.reference.day.latest
            && saved.reference.day.previous === market.reference.day.previous) {
            market.rows = saved.rows.filter(row => unique.has(row.symbol));
          }
          market.completed = market.rows.length;
          market.phase = 'scanning';
        } catch (error) { market.phase = 'error'; market.error = error.message; }
        job.updatedAt = isoNow();
      }
    }));
    await checkpoint(true);
    // Interleave markets so all four progress, rather than making Japan wait for Nasdaq.
    const queue = [];
    const remaining = activeMarkets.map(m => {
      const checked = new Set(m.rows.map(row => row.symbol));
      return m.phase === 'scanning' ? m.items.filter(item => !checked.has(item.symbol)) : [];
    });
    const maximum = Math.max(0, ...remaining.map(items => items.length));
    for (let i = 0; i < maximum; i++) for (let j = 0; j < activeMarkets.length; j++) {
      if (remaining[j][i]) queue.push({ market: activeMarkets[j], item: remaining[j][i] });
    }
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < queue.length) {
        const { market, item } = queue[cursor++];
        if (market.phase === 'error') continue;
        try {
          const history = await loadHistory(item.symbol, market.key, HISTORY_LIMIT);
          // Validate rather than silently filling missing candles or calculating a short MA.
          normalizeDailyHistory(history);
          let data = analyzeMa200History(history, market.reference);
          if (data.week.status === 'short-history') {
            if (market.weeklySourceError) {
              data.week = { status: 'error', error: market.weeklySourceError };
            } else {
              try {
                const weekly = await loadWeeklyHistory(item.symbol, market.key, 300);
                if (!Array.isArray(weekly) || !weekly.length) throw new Error('주봉 추가 조회 결과가 비어 있습니다.');
                data = analyzeMa200History(history, market.reference, weekly);
                market.weeklyFailuresInRow = 0;
              } catch (error) {
                data.week = { status: 'error', error: `주봉 추가 조회 실패: ${error.message}` };
                const systemic = /429|5\d\d|timeout|timed.?out|abort|fetch failed|network|ECONN|ENOTFOUND/i.test(error.message);
                market.weeklyFailuresInRow = systemic ? (market.weeklyFailuresInRow || 0) + 1 : 0;
                if (market.weeklyFailuresInRow >= 5) {
                  market.weeklySourceError = '주봉 추가 조회가 5회 연속 실패해 추가 조회를 중단했습니다. 새로 검색으로 다시 시도할 수 있습니다.';
                }
              }
            }
          }
          market.rows.push({ ...item, ...data, fetchedAt: isoNow() });
          market.failuresInRow = 0;
        } catch (error) {
          market.rows.push({ ...item, day: { status: 'error', error: error.message }, week: { status: 'error', error: error.message } });
          const systemic = /429|5\d\d|timeout|timed.?out|abort|fetch failed|network|ECONN|ENOTFOUND/i.test(error.message);
          market.failuresInRow = systemic ? (market.failuresInRow || 0) + 1 : 0;
          if (market.failuresInRow >= 5) {
            market.phase = 'error';
            market.error = '자료 조회가 5회 연속 실패해 이 시장 검색을 중단했습니다. 다시 검색할 수 있습니다.';
          }
        }
        market.completed = market.rows.length;
        job.updatedAt = isoNow();
        void checkpoint();
      }
    }));
    for (const market of activeMarkets) if (market.phase === 'scanning') market.phase = 'done';
    job.status = activeMarkets.some(m => m.phase === 'error') ? 'partial' : 'done';
    job.completedAt = job.updatedAt = isoNow();
    await checkpoint(true);
  }

  async function start(force = false) {
    await restoreOnce();
    if (runner) return;
    if (!force && ['done', 'partial'].includes(state?.status) && now() - Date.parse(state.completedAt) < CACHE_MS) return;
    const previous = state;
    state = { version: SCAN_VERSION, status: 'running', startedAt: isoNow(), updatedAt: isoNow(),
      persistenceError: previous?.persistenceError || '', markets: Object.keys(SCAN_MARKETS).map(key => ({
        key, phase: 'loading', total: 0, completed: 0, items: [], rows: [], error: '',
      })) };
    runner = run(state, force ? null : previous).catch(error => {
      state.status = 'partial';
      state.error = error.message;
    }).finally(() => { runner = null; });
  }
  async function snapshot(interval = 'day') {
    await restoreOnce();
    if (!state) return { status: 'idle', markets: [] };
    const weeklyIncomplete = interval === 'week' && state.markets.some(m => m.weeklySourceError);
    return { status: state.status === 'done' && weeklyIncomplete ? 'partial' : state.status, startedAt: state.startedAt, updatedAt: state.updatedAt,
      completedAt: state.completedAt, error: state.error, persistenceError: state.persistenceError,
      stale: now() - Date.parse(state.updatedAt) >= CACHE_MS,
      markets: state.markets.map(m => {
        const checked = m.rows.map(row => ({ symbol: row.symbol, name: row.name, ...row[interval] }));
        const excluded = checked.filter(row => row.status !== 'ready');
        return { key: m.key, label: SCAN_MARKETS[m.key].label, phase: interval === 'week' && m.weeklySourceError ? 'error' : m.phase,
          error: m.error || (interval === 'week' ? m.weeklySourceError : ''),
          total: m.total, completed: m.completed, valid: checked.length - excluded.length,
          reference: m.reference, source: m.source, sourceDate: m.sourceDate,
          results: checked.filter(row => row.status === 'ready' && row.signal),
          excludedCount: excluded.length, excluded: excluded.slice(0, 100),
          exclusionCounts: Object.fromEntries(['short-history', 'stale', 'error'].map(status => [status, excluded.filter(row => row.status === status).length])),
        };
      }) };
  }
  return { start, snapshot, settled: async () => { await runner; await writes; } };
}
