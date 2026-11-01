import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../api';
import { SCAN_MARKETS } from '../utils/ma200Scan';
import { MA_CROSS_PAIRS } from '../utils/maCrossScan';
import { activeCommonConditions, conditionLabel } from '../utils/commonScan';
import { filterScanResults } from '../utils/scanResults';
import { scanStockLabel } from '../utils/scanTable';
import { useVisibleStock } from '../state/stockResources';
import PositionButtons from './PositionButtons';
import { useFinancialSort } from '../state/useFinancialSort';
import { FinancialCells, FinancialColumns, FinancialHeaders, FinancialSortStatus } from './FinancialTable';
import StockChartDialog from './StockChartDialog';

const initialCondition = (kind = 'line-break') => ({ kind, interval: 'day', direction: 'breakout', target: 'candle', pair: '5-20' });
function CommonResultRow({ row, onOpen, financialRecord }) {
  const [ref, visible] = useVisibleStock();
  return <tr ref={ref}>
    <td className="scan-stock-cell"><button className="scan-stock-link" type="button" aria-haspopup="dialog" aria-label={`${row.name} 차트 보기`}
      title={row.name} onClick={() => onOpen(row)}>{scanStockLabel(row.name)}</button><small>{row.symbol}</small></td>
    <td>{row.marketLabel}<small>{SCAN_MARKETS[row.market]?.currency}</small></td>
    <td className="common-match-cell">{row.matches.map((match, i) => <div key={i}>
      <span className={['breakout', 'bullish'].includes(match.signal) ? 'scan-up' : 'scan-down'}>{conditionLabel({ ...match.condition,
        direction: ['breakout', 'bullish'].includes(match.signal) ? 'breakout' : 'breakdown' })}</span>
      <small>{match.latest.date}</small>
    </div>)}</td>
    <td className="saved-record-cell"><PositionButtons symbol={row.symbol} name={row.name} /></td>
    <FinancialCells symbol={visible ? row.symbol : null} record={financialRecord} />
  </tr>;
}

export default function CommonScanner({ showBollinger = false }) {
  const [conditions, setConditions] = useState([initialCondition(), initialCondition('cloud'), initialCondition('')]);
  const key = JSON.stringify(activeCommonConditions(conditions));
  const [record, setRecord] = useState(null), [error, setError] = useState('');
  const [marketFilter, setMarketFilter] = useState('all'), [search, setSearch] = useState('');
  const [refresh, setRefresh] = useState(0), [page, setPage] = useState(1);
  const consumedRefresh = useRef(0);
  const [popupInterval, setPopupInterval] = useState('day'), [stock, setStock] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer, stopped = false, first = true;
    async function update() {
      try {
        const force = first && refresh > consumedRefresh.current;
        if (force) consumedRefresh.current = refresh;
        first = false;
        const response = await fetch(apiUrl(`/common-scan?conditions=${encodeURIComponent(key)}${force ? '' : '&start=1'}`), {
          method: force ? 'POST' : 'GET', signal: controller.signal, cache: 'no-store',
          headers: { 'x-stock5-password': localStorage.getItem('stock5-0-password') || '' },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '공통 검색 조회 실패');
        if (data.indicator !== 'common' || !Array.isArray(data.markets)) throw new Error('공통 검색 API 버전이 맞지 않습니다. 서버와 프런트엔드를 함께 업데이트하세요.');
        if (stopped) return;
        setRecord({ key, data }); setError('');
        if (['running', 'interrupted'].includes(data.status)) timer = setTimeout(update, 15000);
      } catch (failure) {
        if (!stopped && failure.name !== 'AbortError') { setError(failure.message); timer = setTimeout(update, 15000); }
      }
    }
    timer = setTimeout(update, 200);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [key, refresh]);
  const data = record?.key === key ? record.data : null;
  const filteredRows = filterScanResults(data, { marketFilter, search });
  const sorting = useFinancialSort(filteredRows);
  const rows = sorting.sortedRows;
  const pages = Math.max(1, Math.ceil(rows.length / 100)), current = Math.min(page, pages);
  const running = !data || ['running', 'interrupted'].includes(data.status);
  const change = (index, field, value) => { setPage(1); setConditions(values => values.map((v, i) => i === index ? { ...v, [field]: value } : v)); };
  return <main className="ma200-scanner common-scanner">
    <div className="scan-toolbar"><h1>10. 공통항목</h1>
      <button type="button" onClick={() => setConditions(v => [...v, initialCondition('ma-cross')])} disabled={conditions.length >= 8}>조건 추가</button>
      <button type="button" onClick={() => setRefresh(v => v + 1)} disabled={running}>새로 검색</button>
    </div>
    <p className="scan-description">7·8·9번의 일봉/주봉 조건을 2~8개 선택하세요. 조건 1·2는 필수이며 조건 3부터는 「- (미포함)」을 선택해 제외할 수 있습니다. 선택한 조건을 모두 만족하는 종목만 표시합니다(AND). 최근 두 봉에서 발생한 전환/교차를 비교하며 과거 신호의 단순 유지 여부가 아닙니다. 양운·음운 및 두께 0인 선 교차는 8번과 같은 기준입니다.</p>
    <div className="common-conditions">{conditions.map((condition, index) => <fieldset className="common-condition" key={index}>
      <legend>조건 {index + 1}</legend>
      <select aria-label={`조건 ${index + 1} 지표`} value={condition.kind} onChange={e => change(index, 'kind', e.target.value)}>
        {index >= 2 && <option value="">- (미포함)</option>}
        <option value="line-break">7. 삼선전환도</option><option value="cloud">8. 구름돌파</option><option value="ma-cross">9. 골든/데드 크로스</option>
      </select>
      {condition.kind && <>
      <select aria-label={`조건 ${index + 1} 봉 단위`} value={condition.interval} onChange={e => change(index, 'interval', e.target.value)}><option value="day">일봉</option><option value="week">주봉</option></select>
      {condition.kind === 'cloud' && <select aria-label={`조건 ${index + 1} 구름 기준`} value={condition.target} onChange={e => change(index, 'target', e.target.value)}><option value="candle">캔들 종가</option><option value="ma20">20이평선 자체</option></select>}
      {condition.kind === 'ma-cross' && <select aria-label={`조건 ${index + 1} 이평 조합`} value={condition.pair} onChange={e => change(index, 'pair', e.target.value)}>{Object.keys(MA_CROSS_PAIRS).map(pair => <option key={pair} value={pair}>{pair.replace('-', '/')} 이평</option>)}</select>}
      <select aria-label={`조건 ${index + 1} 방향`} value={condition.direction} onChange={e => change(index, 'direction', e.target.value)}>
        <option value="all">양방향</option><option value="breakout">{condition.kind === 'line-break' ? '양전환' : condition.kind === 'cloud' ? '돌파' : '골든크로스'}</option><option value="breakdown">{condition.kind === 'line-break' ? '음전환' : condition.kind === 'cloud' ? '하락' : '데드크로스'}</option>
      </select>
      </>}
      <button type="button" aria-label={`조건 ${index + 1} 삭제`} disabled={index < 3} onClick={() => { setPage(1); setConditions(v => v.filter((_, i) => i !== index)); }}>조건 삭제</button>
    </fieldset>)}</div>
    <div className="scan-toolbar">
      <select aria-label="공통 검색 시장 필터" value={marketFilter} onChange={e => { setMarketFilter(e.target.value); setPage(1); }}><option value="all">모든 시장</option>{Object.entries(SCAN_MARKETS).map(([value, market]) => <option key={value} value={value}>{market.label}</option>)}</select>
      <input aria-label="공통 결과 종목명 또는 코드" placeholder="종목명 / 코드" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      <label>팝업 차트 <select aria-label="공통 종목 팝업 봉 단위" value={popupInterval} onChange={e => setPopupInterval(e.target.value)}><option value="day">일봉</option><option value="week">주봉</option></select></label>
    </div>
    {error && <p className="scan-error" role="alert">{error}</p>}{data?.error && <p className="scan-error" role="alert">{data.error}</p>}
    <p role="status" className="scan-progress">{running ? '공통 조건 검색 중 · 현재까지의 교집합' : data?.status === 'done' ? '공통 조건 검색 완료' : '일부 시장 미완료 · 현재 확인된 교집합'} · {rows.length}종목{data?.stale && ' · 이전 자료: 새로 검색이 필요합니다.'}</p>
    <div className="scan-market-grid">{(data?.markets || []).map(m => <section key={m.key} className="scan-market"><h2>{m.label}</h2><p>{m.completed}/{m.total} 조건별 확인 · 공통 {m.results.length}종목</p>{m.error && <p className="scan-error">{m.error}</p>}
      {m.diagnostics?.some(d => d.excluded) && <details><summary>조건별 계산 제외 현황</summary>{m.diagnostics.map((d, i) => <p key={i}>{d.label}: 계산 가능 {d.valid} · 제외 {d.excluded} (조회 실패 {d.errors})</p>)}</details>}
    </section>)}</div>
    <FinancialSortStatus sorting={sorting} />
    <div className="scan-result-caption">모든 조건에 해당하는 종목 {rows.length}개{pages > 1 && <span><button type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>이전</button> {current}/{pages} <button type="button" disabled={current === pages} onClick={() => setPage(current + 1)}>다음</button></span>}</div>
    <div className="scan-table-wrap" role="region" aria-label="공통항목 검색 결과 표" tabIndex={0}><table className="scan-table common-scan-table">
      <colgroup><col className="scan-stock-col" /><col className="scan-market-col" /><col className="common-match-col" /><col className="scan-record-col" /><FinancialColumns /></colgroup>
      <thead><tr><th className="scan-stock-cell">종목</th><th>시장 / 통화</th><th>동시에 해당하는 조건 / 최근 비교일</th><th>롱·숏 / 준비! / 주의!</th><FinancialHeaders sorting={sorting} onSort={metric => { sorting.toggle(metric); setPage(1); }} /></tr></thead>
      <tbody>{rows.slice((current - 1) * 100, current * 100).map(row => <CommonResultRow key={`${row.market}-${row.symbol}`} row={row} financialRecord={sorting.records[row.symbol]} onOpen={row => setStock({ symbol: row.symbol, name: row.name, weekly: popupInterval === 'week' })} />)}</tbody>
    </table></div>
    {!rows.length && <p className="scan-empty">{running ? '검색 중입니다. 모든 조건을 만족한 종목이 확인되면 표시합니다.' : data?.status === 'done' ? '계산 가능한 종목 중 선택한 모든 조건에 동시에 해당하는 종목이 없습니다. 조건별 제외 현황도 확인하세요.' : '현재 확인된 공통 종목이 없습니다. 미완료 시장과 오류를 확인하세요.'}</p>}
    {stock && <StockChartDialog key={stock.symbol} stock={stock} showBollinger={showBollinger} onClose={() => setStock(null)} />}
  </main>;
}
