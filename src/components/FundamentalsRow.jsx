import { useEffect, useState } from 'react';
import { apiUrl } from '../api';
import { fundamentalMetrics } from '../utils/fundamentalMetrics';

const REFRESH_MS = 6 * 60 * 60 * 1000;

export default function FundamentalsRow({ symbol }) {
  const [record, setRecord] = useState({ symbol: '', data: null, error: '' });
  useEffect(() => {
    if (!symbol) return undefined;
    let stopped = false;
    let request;
    const update = async () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(apiUrl(`/fundamentals?symbol=${encodeURIComponent(symbol)}`), { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || '재무정보 조회 실패');
        if (data?.symbol !== symbol.toUpperCase()) throw new Error('재무정보 종목이 일치하지 않습니다.');
        if (!stopped) setRecord({ symbol, data, error: '' });
      } catch (error) {
        if (!stopped) setRecord({ symbol, data: null, error: error.message });
      } finally { clearTimeout(timeout); }
    };
    void update();
    const timer = setInterval(() => { if (!document.hidden) void update(); }, REFRESH_MS);
    return () => { stopped = true; request?.abort(); clearInterval(timer); };
  }, [symbol]);

  const current = record.symbol === symbol;
  const data = current && record.data ? record.data : {};
  const title = current && record.error ? record.error
    : `재무정보: ${data.source || '조회 중'} · 실적 ${data.periodType || '연간'} ${data.period || '—'} · 예상 ${data.forwardPeriod || '—'} · *는 추정값 · 미제공 값은 —`;
  return <div className="fundamentals-row" aria-label="종목 재무정보" aria-busy={!current} title={title}>
    {fundamentalMetrics(data).map(metric => <span className="fundamentals-metric" key={metric.key} title={metric.hint}>
      <span>{metric.label}</span><b>{metric.value}</b>
    </span>)}
  </div>;
}
