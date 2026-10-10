import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../api';
import { SCAN_MARKETS } from '../utils/ma200Scan';
import StockChartDialog from './StockChartDialog';
import { scanStockLabel } from '../utils/scanTable';
import { downloadScanXlsx } from '../utils/scanExport';

const formatPrice = value => Number.isFinite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '—';
const excludedReason = (row, interval, lineBreak) => row.status === 'short-history'
  ? lineBreak ? `전환선 부족 (${row.availableLines || 0}/3선 · ${row.available}개 ${interval === 'week' ? '주봉' : '일봉'})`
    : `${interval === 'week' ? '주봉' : '일봉'} 자료 부족 (${row.available}/201)${row.supplemented ? ' · 주봉 추가 조회 후에도 부족' : ''}`
  : row.status === 'stale' ? `최근 거래일 불일치 (${row.latestDate || '자료 없음'})` : row.error || '조회 실패';

export default function Ma200Scanner({ showBollinger = false, showLineBreak = false, globalWeekly = false, indicator = 'ma200' }) {
  const lineBreak = indicator === 'line-break';
  const title = lineBreak ? '삼선전환도 양전환/음전환' : '200이평 돌파/붕괴';
  const endpoint = lineBreak ? 'line-break-scan' : 'ma200-scan';
  const upSignal = lineBreak ? 'bullish' : 'breakout';
  const downSignal = lineBreak ? 'bearish' : 'breakdown';
  const upLabel = lineBreak ? '양전환' : '돌파';
  const downLabel = lineBreak ? '음전환' : '붕괴';
  const [interval, setInterval] = useState('day');
  const [direction, setDirection] = useState('all');
  const [marketFilter, setMarketFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const consumedRefresh = useRef(0);
  const [page, setPage] = useState(1);
  const [selectedStock, setSelectedStock] = useState(null);
  const closeChart = useCallback(() => setSelectedStock(null), []);
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    let stopped = false;
    let first = true;
    async function update() {
      const force = first && refresh > consumedRefresh.current;
      if (force) consumedRefresh.current = refresh;
      // Repeating start is idempotent: recover an initial connection failure or
      // a server restart without ever launching a duplicate background scan.
      const url = apiUrl(`/${endpoint}?interval=${interval}${!force ? '&start=1' : ''}`);
      first = false;
      try {
        const response = await fetch(url, { method: force ? 'POST' : 'GET', signal: controller.signal,
          headers: { 'x-stock5-password': localStorage.getItem('stock5-0-password') || '' }, cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || '종목 검색 조회 실패');
        if (!Array.isArray(data.markets)) throw new Error('검색 응답 형식이 잘못되었습니다.');
        if (stopped) return;
        setRecord({ interval, data });
        setError('');
        if (data.status === 'running' || data.status === 'interrupted') timer = setTimeout(update, 15000);
      } catch (failure) {
        if (!stopped && failure.name !== 'AbortError') {
          setError(failure.message);
          timer = setTimeout(update, 15000);
        }
      }
    }
    void update();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [interval, refresh, endpoint]);

  const data = record?.interval === interval ? record.data : null;
  const markets = data?.markets || [];
  const running = ['running', 'interrupted'].includes(data?.status);
  const rows = markets.filter(m => marketFilter === 'all' || m.key === marketFilter).flatMap(m =>
    m.results.map(row => ({ ...row, market: m.key, marketLabel: m.label })));
  const matches = rows.filter(row => (direction === 'all' || row.signal === direction)
    && `${row.name} ${row.symbol}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(matches.length / 100));
  const currentPage = Math.min(page, pages);
  const visible = matches.slice((currentPage - 1) * 100, currentPage * 100);
  const total = markets.reduce((sum, m) => sum + m.total, 0);
  const completed = markets.reduce((sum, m) => sum + m.completed, 0);
  const changeFilter = setter => event => { setter(event.target.value); setPage(1); };
  const saveExcel = () => {
    try {
      downloadScanXlsx({ indicator, interval, direction, marketFilter, search, data, matches });
      setExportError('');
    } catch (failure) { setExportError(`엑셀 저장 실패: ${failure.message}`); }
  };

  return <main className="ma200-scanner">
    <div className="scan-toolbar">
      <h1>{title}</h1>
      <div className="scan-timeframes" aria-label="검색 봉 단위">
        <button type="button" aria-pressed={interval === 'day'} onClick={() => { setInterval('day'); setPage(1); }}>일</button>
        <button type="button" aria-pressed={interval === 'week'} onClick={() => { setInterval('week'); setPage(1); }}>주</button>
      </div>
      <select aria-label={lineBreak ? '양전환 음전환 필터' : '돌파 붕괴 필터'} value={direction} onChange={changeFilter(setDirection)}>
        <option value="all">{upLabel} + {downLabel}</option><option value={upSignal}>{upLabel}</option><option value={downSignal}>{downLabel}</option>
      </select>
      <select aria-label="검색 시장 필터" value={marketFilter} onChange={changeFilter(setMarketFilter)}>
        <option value="all">모든 시장</option>
        {Object.entries(SCAN_MARKETS).map(([key, market]) => <option value={key} key={key}>{market.label}</option>)}
      </select>
      <input aria-label="검색 결과 종목명 또는 코드" placeholder="종목명 / 코드" value={search} onChange={changeFilter(setSearch)} />
      <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={running}>새로 검색</button>
      <button type="button" onClick={saveExcel} disabled={!data} title="현재 필터의 모든 페이지 결과를 이 기기에 다운로드합니다. 서버에 엑셀 파일을 저장하지 않습니다.">엑셀 저장</button>
    </div>
    <p className="scan-description">엑셀 저장: 현재 필터의 모든 페이지 결과와 검색 요약을 접속한 기기에 다운로드합니다. 서버에는 엑셀 파일을 저장하지 않습니다. 검색 중에는 현재까지의 결과를 저장합니다.</p>
    {exportError && <p role="alert" className="scan-error">{exportError}</p>}
    <p className="scan-description">
      {lineBreak ? `${interval === 'day' ? '일봉 종가' : '주봉 마지막 종가'}로 삼선전환도를 만들고, ${interval === 'day' ? '최근 거래일' : '최근 주봉'}에서 새로 양전환·음전환한 종목을 찾습니다.`
        : interval === 'day' ? '최근 두 실제 거래일의 종가와 각 날짜의 200일 단순이평을 비교합니다.'
        : '최근 두 주봉의 마지막 종가와 각 주의 200주 단순이평을 비교합니다. 최근 주봉은 진행 중일 수 있습니다.'}
      {lineBreak ? ' 음선 상태에서 최근 전환선 3개의 최고가를 초과하면 양전환, 양선 상태에서 최저가 미만이면 음전환입니다. 기준가와 같거나 기존 방향을 유지하면 제외합니다.'
        : ' 돌파: 이전 ≤ 이평, 최근 ≥ 이평. 붕괴: 이전 ≥ 이평, 최근 ≤ 이평. 두 기간 모두 이평과 같으면 제외합니다.'}
      {' '}장중 종가는 조회 시점의 값이며 신호가 바뀔 수 있습니다.
    </p>
    {lineBreak && <p className="scan-description">최근 캔들 3개가 아닌 실제 생성된 전환선 3개를 비교합니다. 확보된 일봉 최대 1,250개와 주봉 자료로 계산하며, 전환선이 충분하지 않으면 제외합니다. 최근 주봉은 진행 중일 수 있습니다. 6번·7번은 같은 백그라운드 검색을 공유합니다.</p>}
    <p className="scan-description">KOSPI·KOSDAQ 전체 주식, NASDAQ 상장주식(ETF·테스트·워런트·유닛·권리·채권 제외), 도쿄 Prime·Standard·Growth 주식. 일본 목록은 JPX의 최근 월말 자료 기준입니다.</p>
    {!lineBreak && interval === 'week' && <p className="scan-description">주봉이 201개 미만이면 주봉 자료를 추가 조회합니다. 상장 기간이 짧거나 제공 자료가 여전히 부족한 종목은 200주 이평을 정확히 계산할 수 없어 제외합니다.</p>}
    {error && <p role="alert" className="scan-error">{error}</p>}
    {data?.persistenceError && <p role="alert" className="scan-error">검색 진행 저장 오류: {data.persistenceError}</p>}
    {data?.error && <p role="alert" className="scan-error">{data.error}</p>}
    <p role="status" className="scan-progress">
      {!data ? '검색 준비 중...' : running ? `전체 검색 중 · ${completed.toLocaleString()}/${total.toLocaleString()}종목 확인 · 발견 ${rows.length}종목 (진행 중 결과)`
        : data.status === 'done' ? `전체 검색 완료 · ${completed.toLocaleString()}종목 확인 · 발견 ${rows.length}종목`
          : '일부 시장 검색이 완료되지 않았습니다. 오류를 확인한 뒤 새로 검색하세요.'}
      {data?.updatedAt && <> · 조회 {new Date(data.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</>}
      {data?.stale && ' · 이전 검색 자료입니다. 새로 검색하면 갱신합니다.'}
    </p>
    <div className="scan-market-grid">
      {Object.entries(SCAN_MARKETS).map(([key, market]) => {
        const info = markets.find(m => m.key === key);
        const reference = info?.reference?.[interval];
        return <section className="scan-market" key={key} aria-label={market.label}>
          <h2>{market.label}</h2>
          <p>{info ? `${info.completed.toLocaleString()}/${info.total.toLocaleString()} 확인 · 계산 가능 ${info.valid} · 제외 ${info.excludedCount}` : '목록 준비 중...'}</p>
          {reference && <p>{interval === 'week' ? '주 시작' : '거래일'} {reference.previous} → {reference.latest}</p>}
          {info?.sourceDate && <small>종목 목록 기준: {info.sourceDate}</small>}
          {info?.error && <p className="scan-error" role="alert">{info.error}</p>}
          {info?.excludedCount > 0 && <details>
            <summary>제외 사유 ({info.excludedCount}종목)</summary>
            <p>{lineBreak ? '전환선 부족' : '이력 부족'} {info.exclusionCounts['short-history']} · 날짜 불일치 {info.exclusionCounts.stale} · 조회 실패 {info.exclusionCounts.error}</p>
            {info.excluded.slice(0, 100).map(row => <p key={row.symbol}>{row.name} ({row.symbol}): {excludedReason(row, interval, lineBreak)}</p>)}
            {info.excludedCount > 100 && <p>제외 상세는 처음 100종목까지 표시합니다.</p>}
          </details>}
        </section>;
      })}
    </div>
    <div className="scan-result-caption">조건에 맞는 종목 {matches.length}개
      {pages > 1 && <span><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</button> {currentPage}/{pages} <button type="button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>다음</button></span>}
    </div>
    <div className="scan-table-wrap" role="region" aria-label={lineBreak ? '삼선전환도 검색 결과 표' : '200이평 검색 결과 표'} tabIndex={0}><table className="scan-table">
      <colgroup><col className="scan-stock-col" /><col className="scan-market-col" /><col className="scan-signal-col" /><col className="scan-date-col" /><col span={5} /></colgroup>
      <thead><tr><th scope="col" className="scan-stock-cell">종목</th><th scope="col">시장 / 통화</th><th scope="col">구분</th><th scope="col">비교일 (이전 → 최근)</th>
        {lineBreak ? <><th scope="col">이전 종가</th><th scope="col">최근 종가</th><th scope="col">이전 방향</th><th scope="col">전환 기준가</th><th scope="col">기준가 대비</th></>
          : <><th scope="col">이전 종가</th><th scope="col">이전 200이평</th><th scope="col">최근 종가</th><th scope="col">최근 200이평</th><th scope="col">최근 괴리율</th></>}</tr></thead>
      <tbody>{visible.map(row => <tr key={`${row.market}-${row.symbol}`}>
        <td className="scan-stock-cell"><button type="button" className="scan-stock-link" aria-haspopup="dialog" title={row.name} aria-label={`${row.name} 차트 보기`}
          onClick={() => setSelectedStock({ symbol: row.symbol, name: row.name, weekly: interval === 'week' })}>{scanStockLabel(row.name)}</button>
          <small title={row.symbol}>{row.symbol}</small></td><td>{row.marketLabel}<small>{SCAN_MARKETS[row.market].currency}</small></td>
        <td className={row.signal === upSignal ? 'scan-up' : 'scan-down'}>{row.signal === upSignal ? upLabel : downLabel}</td>
        <td>{row.previous.date} → {row.latest.date}</td><td>{formatPrice(row.previous.close)}</td>
        {lineBreak ? <><td>{formatPrice(row.latest.close)}</td><td>{row.previous.direction === 'up' ? '양선' : '음선'}</td><td>{formatPrice(row.reversalPrice)}</td></>
          : <><td>{formatPrice(row.previous.ma200)}</td><td>{formatPrice(row.latest.close)}</td><td>{formatPrice(row.latest.ma200)}</td></>}
        <td className={row.signal === upSignal ? 'scan-up' : 'scan-down'}>{row.distancePct > 0 ? '+' : ''}{row.distancePct.toFixed(2)}%</td>
      </tr>)}</tbody>
    </table></div>
    {matches.length === 0 && <p className="scan-empty">{!data || running ? '검색이 진행되면 조건에 맞는 종목을 이곳에 표시합니다.'
      : data.status !== 'done' ? '현재 발견된 결과가 없습니다. 미완료 시장과 조회 오류를 확인하세요.' : '계산 가능한 종목 중 선택한 조건에 맞는 종목이 없습니다.'}</p>}
    {selectedStock && <StockChartDialog key={selectedStock.symbol} stock={selectedStock}
      showBollinger={showBollinger} showLineBreak={showLineBreak} globalWeekly={globalWeekly} onClose={closeChart} />}
  </main>;
}
