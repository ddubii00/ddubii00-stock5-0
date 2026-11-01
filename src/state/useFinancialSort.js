import { useEffect, useMemo, useState } from 'react';
import { stockResource } from './stockResources.js';
import { loadFinancialSortRecords, sortFinancialRows } from '../utils/financialSort.js';

export function useFinancialSort(rows) {
  const [sort, setSort] = useState(null);
  const [request, setRequest] = useState(0);
  const [snapshot, setSnapshot] = useState({ key: '', records: {}, completed: 0, failures: 0 });
  const key = JSON.stringify([...new Set(rows.map(row => row.symbol))].sort());
  const enabled = Boolean(sort);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    void loadFinancialSortRecords(JSON.parse(key), symbol => stockResource('fundamentals', symbol), {
      stopped: () => stopped,
      onProgress: progress => { if (!stopped) setSnapshot({ key, request, ...progress }); },
    });
    return () => { stopped = true; };
  }, [key, enabled, request]);
  const total = JSON.parse(key).length;
  const current = snapshot.key === key && snapshot.request === request;
  const completed = current ? snapshot.completed : 0;
  const ready = enabled && completed === total;
  const sortedRows = useMemo(() => ready ? sortFinancialRows(rows, snapshot.records, sort) : rows, [rows, ready, snapshot.records, sort]);
  return { sort, sortedRows, loading: enabled && !ready, completed, total,
    failures: current ? snapshot.failures : 0, records: enabled && current ? snapshot.records : {},
    toggle: metric => {
      if (!enabled) setRequest(value => value + 1);
      setSort(previous => ({ key: metric, direction: previous?.key === metric && previous.direction === 'asc' ? 'desc' : 'asc' }));
    },
    clear: () => setSort(null) };
}
