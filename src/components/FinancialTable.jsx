import { useStockResource } from '../state/stockResources';
import { fundamentalMetrics } from '../utils/fundamentalMetrics';
import { FINANCIAL_SORT_COLUMNS } from '../utils/financialSort';

export function FinancialColumns() {
  return FINANCIAL_SORT_COLUMNS.map(column => <col key={column.key} className={`stock-financial-col financial-metric-col${column.amount ? ' financial-amount-col' : ''}`} />);
}

export function FinancialHeaders({ sorting, onSort }) {
  return FINANCIAL_SORT_COLUMNS.map(column => <th scope="col" key={column.key} className="financial-sort-header"
    aria-sort={sorting.sort?.key === column.key ? sorting.sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
    <button type="button" aria-label={`${column.label} 정렬`} title={`${column.hint} · 클릭할 때마다 오름차순/내림차순`}
      onClick={() => onSort(column.key)}>{column.label}{column.amount && '(조)'}<span aria-hidden="true">{sorting.sort?.key === column.key ? sorting.sort.direction === 'asc' ? ' ▲' : ' ▼' : ' ↕'}</span></button>
  </th>);
}

export function FinancialCells({ symbol, record }) {
  const fetched = useStockResource('fundamentals', record ? null : symbol);
  const value = record || fetched;
  return fundamentalMetrics(value.data || {}).map(metric => <td key={metric.key} className="financial-metric-cell" data-financial-key={metric.key}
    title={value.error || `${metric.hint}${value.data?.source ? ` · ${value.data.source}` : ''}`}>
    {metric.value}{metric.label.endsWith('*') && <sup title="추정값">*</sup>}
  </td>);
}

export function FinancialSortStatus({ sorting }) {
  if (!sorting.sort) return null;
  const column = FINANCIAL_SORT_COLUMNS.find(item => item.key === sorting.sort.key);
  return <div className="financial-sort-status">
    <span role="status">{sorting.loading ? `전체 결과 재무정보 조회 중 ${sorting.completed}/${sorting.total} · 조회가 끝나면 전체 정렬합니다.`
      : `${column.label} ${sorting.sort.direction === 'asc' ? '오름차순' : '내림차순'} · 전체 ${sorting.total}종목 · 미제공 값은 마지막${sorting.failures ? ` · 조회 실패 ${sorting.failures}건` : ''}`}</span>
    <button type="button" onClick={sorting.clear}>정렬 해제</button>
    {column.amount && <span>금액은 표시 통화 기준이며 통화 환산은 하지 않습니다. 시장 필터를 함께 사용하세요.</span>}
  </div>;
}
