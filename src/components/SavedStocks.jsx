import { useCallback, useState } from 'react';
import { useSharedPositions } from '../state/sharedPositions';
import { POSITION_GROUPS } from '../utils/positionGroups';
import StockListRow from './StockListRow';
import StockChartDialog from './StockChartDialog';

export default function SavedStocks({ showBollinger, globalWeekly }) {
  const { positions, authError } = useSharedPositions();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedStock, setSelectedStock] = useState(null);
  const closeChart = useCallback(() => setSelectedStock(null), []);
  const stocks = Object.values(positions).filter(stock => `${stock.name} ${stock.symbol}`.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = [...POSITION_GROUPS, ['', '준비! · 주의!만 표시한 종목']];
  return <main className="ma200-scanner saved-stocks">
    <div className="scan-toolbar"><h1>종목들</h1>
      <select aria-label="저장 종목 구분" value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">모든 기록</option>
        {groups.map(([status, label]) => <option value={status} key={status}>{label}</option>)}
      </select>
      <input aria-label="저장 종목명 또는 코드" placeholder="종목명 / 코드" value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    <p className="scan-description">1~7번에서 표시한 공유 기록입니다. 준비!는 초록색, 주의!는 노란색입니다. 다시 누르면 해제됩니다. 롱·숏 분류 변경은 종목명을 눌러 연 차트 팝업에서 할 수 있습니다.</p>
    <p className="scan-description">재무정보는 한 줄로 표시하며 좁은 화면에서는 표 안에서 가로 스크롤합니다. 미제공 값은 —, 추정값은 *로 표시합니다.</p>
    {authError && <p className="scan-error" role="alert">{authError}</p>}
    {groups.filter(([status]) => filter === 'all' || filter === status).map(([status, label]) => {
      const items = stocks.filter(stock => stock.status === status || (!status && !stock.status))
        .sort((a, b) => (a.name || a.symbol).localeCompare(b.name || b.symbol, 'ko'));
      if (!status && !items.length && filter === 'all') return null;
      return <section key={status} className="saved-stock-group" aria-label={label}>
        <h2 className={`saved-group-title ${status}`}>{label} · {items.length}종목</h2>
        {!items.length ? <p className="scan-empty">표시한 종목이 없습니다.</p> : <div className="scan-table-wrap" tabIndex={0} role="region" aria-label={`${label} 종목 표`}>
          <table className="scan-table saved-stock-table"><colgroup><col className="scan-stock-col" /><col className="saved-record-col" /><col className="stock-financial-col" /></colgroup>
            <thead><tr><th className="scan-stock-cell" scope="col">종목</th><th scope="col">준비! / 주의!</th>
              <th scope="col">재무정보</th></tr></thead>
            <tbody>{items.map(stock => <StockListRow key={stock.symbol} stock={stock} onOpen={setSelectedStock} />)}</tbody>
          </table></div>}
      </section>;
    })}
    {selectedStock && <StockChartDialog key={selectedStock.symbol} stock={selectedStock} showBollinger={showBollinger} globalWeekly={globalWeekly} onClose={closeChart} />}
  </main>;
}
