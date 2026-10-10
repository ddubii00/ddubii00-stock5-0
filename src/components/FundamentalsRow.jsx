import { useStockResource } from '../state/stockResources';
import { fundamentalMetrics } from '../utils/fundamentalMetrics';

export default function FundamentalsRow({ symbol }) {
  const record = useStockResource('fundamentals', symbol);
  const data = record.data || {};
  const title = record.error ? record.error
    : `재무정보: ${data.source || '조회 중'} · 실적 ${data.periodType || '연간'} ${data.period || '—'} · 예상 ${data.forwardPeriod || '—'} · *는 추정값 · 미제공 값은 —`;
  return <div className="fundamentals-row" aria-label="종목 재무정보" aria-busy={Boolean(symbol) && !record.data && !record.error} title={title}>
    {fundamentalMetrics(data).map(metric => <span className="fundamentals-metric" key={metric.key} title={metric.hint}>
      <span>{metric.label}</span><b>{metric.value}</b>
    </span>)}
  </div>;
}
