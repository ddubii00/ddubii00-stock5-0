export function filterScanResults(data, { direction = 'all', marketFilter = 'all', search = '' } = {}) {
  return (data?.markets || []).filter(m => marketFilter === 'all' || m.key === marketFilter).flatMap(m =>
    m.results.map(row => ({ ...row, market: m.key, marketLabel: m.label }))).filter(row =>
    (direction === 'all' || row.signal === direction) && `${row.name} ${row.symbol}`.toLowerCase().includes(search.trim().toLowerCase()));
}
