import { fundamentalMetrics } from './fundamentalMetrics.js';

export const FINANCIAL_SORT_COLUMNS = fundamentalMetrics().map(({ key, label, hint }) => ({ key, label, hint,
  amount: ['marketCap', 'revenue', 'operatingIncome'].includes(key) }));

export function financialSortValue(data, key) {
  if (!data || !FINANCIAL_SORT_COLUMNS.some(column => column.key === key) || (key === 'pe' && data.peForward)) return null;
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Sort unrounded numeric values, not formatted text. Missing/failed values stay
// last in BOTH directions; ties keep the existing scanner order across pages.
export function sortFinancialRows(rows, records, sort) {
  if (!sort || !FINANCIAL_SORT_COLUMNS.some(column => column.key === sort.key)) return rows;
  return rows.map((row, index) => ({ row, index, value: financialSortValue(records[row.symbol]?.data, sort.key) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) return a.value === b.value ? a.index - b.index : a.value === null ? 1 : -1;
      return (sort.direction === 'desc' ? b.value - a.value : a.value - b.value) || a.index - b.index;
    }).map(item => item.row);
}

export async function loadFinancialSortRecords(symbols, load, { stopped = () => false, onProgress = () => {} } = {}) {
  const unique = [...new Set(symbols)], records = {};
  let cursor = 0, completed = 0, failures = 0, publishedAt = 0;
  await Promise.all(Array.from({ length: Math.min(2, unique.length) }, async () => {
    while (!stopped() && cursor < unique.length) {
      const symbol = unique[cursor++];
      let result;
      try { result = await load(symbol); }
      catch (error) { result = { data: null, error: error.message }; }
      if (stopped()) return;
      records[symbol] = result;
      completed++;
      if (result.error) failures++;
      if (completed === unique.length || Date.now() - publishedAt > 200) {
        publishedAt = Date.now();
        onProgress({ records: { ...records }, completed, failures });
      }
    }
  }));
  return { records, completed, failures };
}
