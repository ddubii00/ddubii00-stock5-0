import { useCallback, useState } from 'react';
import { useSharedPositions } from '../state/sharedPositions';
import { POSITION_GROUPS, stocksInPositionGroup } from '../utils/positionGroups';
import { SAVED_STOCK_MARKETS, filterSavedStocks } from '../utils/savedStockMarkets';
import StockListRow from './StockListRow';
import StockChartDialog from './StockChartDialog';

export default function SavedStocks({ showBollinger, globalWeekly }) {
  const { positions, authError } = useSharedPositions();
  const [filter, setFilter] = useState('all');
  const [market, setMarket] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedStock, setSelectedStock] = useState(null);
  const closeChart = useCallback(() => setSelectedStock(null), []);
  const stocks = filterSavedStocks(positions, market, query);
  const groups = [...POSITION_GROUPS, ['', '준비! · 주의!만 표시한 종목']];
  return <main className="ma200-scanner saved-stocks">
    <div className="scan-toolbar"><h1>종목들</h1>
      <select aria-label="저장 종목 구분" value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">모든 기록</option>
        {groups.map(([status, label]) => <option value={status} key={status}>{label}</option>)}
      </select>
      <select aria-label="저장 종목 시장구분" value={market} onChange={event => setMarket(event.target.value)}>
        <option value="all">모든 시장</option>
        {SAVED_STOCK_MARKETS.map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select>
      <input aria-label="저장 종목명 또는 코드" placeholder="종목명 / 코드" value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    <p className="scan-description">1~7번에서 표시한 공유 기록입니다. 준비!는 초록색, 주의!는 노란색이며 다시 누르면 해제됩니다. 삭제는 해당 종목의 롱·숏/준비/주의 및 평균가 기록을 초기화하고 공유 목록에서 제거합니다. 롱·숏 분류는 차트 팝업에서도 변경할 수 있습니다.</p>
    <p className="scan-description">준비! · 주의!만 표시한 종목: 네 가지 롱·숏 분류를 선택하지 않고 준비! 또는 주의!만 선택한 종목입니다.</p>
    <p className="scan-description">재무정보는 한 줄로 표시하며 좁은 화면에서는 표 안에서 가로 스크롤합니다. 미제공 값은 —, 추정값은 *로 표시합니다.</p>
    <p className="scan-description">시장구분은 저장된 종목코드 기준입니다. 미국 종목은 거래소 정보가 따로 저장되어 있지 않아 NASDAQ 등 미국 시장으로 묶습니다. 분류 필터와 종목명/코드 검색을 함께 사용할 수 있습니다.</p>
    {authError && <p className="scan-error" role="alert">{authError}</p>}
    {groups.filter(([status]) => filter === 'all' || filter === status).map(([status, label]) => {
      const items = stocksInPositionGroup(stocks, status)
        .sort((a, b) => (a.name || a.symbol).localeCompare(b.name || b.symbol, 'ko'));
      return <section key={status} className="saved-stock-group" aria-label={label}>
        <h2 className={`saved-group-title ${status}`}>{label} · {items.length}종목</h2>
        {!items.length ? <p className="scan-empty">표시한 종목이 없습니다.</p> : <div className="scan-table-wrap" tabIndex={0} role="region" aria-label={`${label} 종목 표`}>
          <table className="scan-table saved-stock-table"><colgroup><col className="scan-stock-col" /><col className="saved-record-col" /><col className="stock-financial-col" /></colgroup>
            <thead><tr><th className="scan-stock-cell" scope="col">종목</th><th scope="col">준비! / 주의! / 삭제</th>
              <th scope="col">재무정보</th></tr></thead>
            <tbody>{items.map(stock => <StockListRow key={stock.symbol} stock={stock} onOpen={setSelectedStock} />)}</tbody>
          </table></div>}
      </section>;
    })}
    {selectedStock && <StockChartDialog key={selectedStock.symbol} stock={selectedStock} showBollinger={showBollinger} globalWeekly={globalWeekly} onClose={closeChart} />}
  </main>;
}
