import { MA_CROSS_PAIRS } from './maCrossScan.js';

export const activeCommonConditions = conditions => conditions.filter(condition => condition.kind && condition.kind !== '-');

export function validateCommonConditions(conditions) {
  if (!Array.isArray(conditions) || conditions.length < 2 || conditions.length > 8) throw new Error('공통 조건은 2~8개를 선택하세요.');
  return conditions.map(condition => {
    if (!condition || !['line-break', 'cloud', 'ma-cross'].includes(condition.kind)
      || !['day', 'week'].includes(condition.interval)
      || !['all', 'breakout', 'breakdown'].includes(condition.direction)) throw new Error('공통 검색 조건이 잘못되었습니다.');
    const { kind, interval, direction } = condition;
    if (kind === 'cloud' && !['candle', 'ma20'].includes(condition.target)) throw new Error('구름 검색 기준을 선택하세요.');
    if (kind === 'ma-cross' && !Object.hasOwn(MA_CROSS_PAIRS, condition.pair)) throw new Error('이평 조합을 선택하세요.');
    return { kind, interval, direction, ...(kind === 'cloud' ? { target: condition.target } : {}), ...(kind === 'ma-cross' ? { pair: condition.pair } : {}) };
  });
}

export function conditionIndicator(condition) {
  return condition.kind === 'cloud' ? condition.target === 'candle' ? 'cloud-candle' : 'cloud'
    : condition.kind === 'ma-cross' ? `ma-cross-${condition.pair}` : 'line-break';
}

export function conditionLabel(condition) {
  const title = condition.kind === 'line-break' ? '삼선' : condition.kind === 'cloud' ? `구름 ${condition.target === 'ma20' ? '20이평' : '종가'}` : `${condition.pair.replace('-', '/')} 이평`;
  const direction = condition.direction === 'all' ? '양방향' : condition.kind === 'line-break'
    ? condition.direction === 'breakout' ? '양전환' : '음전환' : condition.kind === 'ma-cross'
      ? condition.direction === 'breakout' ? '골든크로스' : '데드크로스' : condition.direction === 'breakout' ? '돌파' : '하락';
  return `${title} ${condition.interval === 'week' ? '주봉' : '일봉'} ${direction}`;
}

function matchesDirection(row, condition) {
  return condition.direction === 'all' || row.signal === (condition.kind === 'line-break'
    ? condition.direction === 'breakout' ? 'bullish' : 'bearish' : condition.direction);
}

// Join by market AND code, never display name. Every condition is AND, including
// independently chosen daily/weekly criteria. Do not mix reference sessions.
export function intersectScanSnapshots(conditions, snapshots) {
  const normalized = validateCommonConditions(conditions);
  if (snapshots.length !== normalized.length) throw new Error('조건별 검색 응답이 부족합니다.');
  const markets = snapshots[0].markets.map(first => {
    const sources = snapshots.map(snapshot => snapshot.markets.find(m => m.key === first.key));
    const sessionDates = sources.map((m, i) => {
      const ref = m?.reference?.[normalized[i].interval];
      return ref?.latestDate || ref?.latest;
    });
    const aligned = sessionDates.every(date => date && date === sessionDates[0]);
    const indexed = sources.map((m, i) => new Map((m?.results || []).filter(row => matchesDirection(row, normalized[i])).map(row => [row.symbol, row])));
    const results = aligned ? [...indexed[0].values()].filter(row => indexed.every(map => map.has(row.symbol))).map(row => ({
      symbol: row.symbol, name: row.name, matches: indexed.map((map, i) => ({ ...map.get(row.symbol), condition: normalized[i], label: conditionLabel(normalized[i]) })),
    })) : [];
    return { key: first.key, label: first.label, total: first.total, completed: Math.min(...sources.map(m => m?.completed || 0)),
      phase: sources.every(m => m?.phase === 'done') && aligned ? 'done' : 'scanning', results,
      diagnostics: sources.map((m, i) => ({ label: conditionLabel(normalized[i]), valid: m?.valid || 0,
        excluded: m?.excludedCount || 0, errors: m?.exclusionCounts?.error || 0 })),
      error: !aligned ? '조건별 최근 거래일이 일치하지 않거나 자료를 준비 중입니다.' : sources.map(m => m?.error).filter(Boolean).join(' / ') };
  });
  const running = snapshots.some(s => ['idle', 'running', 'interrupted'].includes(s.status));
  return { indicator: 'common', conditions: normalized, status: running ? 'running'
    : snapshots.every(s => s.status === 'done') && markets.every(m => m.phase === 'done') ? 'done' : 'partial',
    updatedAt: snapshots.map(s => s.updatedAt).filter(Boolean).sort()[0], stale: snapshots.some(s => s.stale),
    error: snapshots.map(s => s.error || s.persistenceError).filter(Boolean).join(' / '), markets };
}
