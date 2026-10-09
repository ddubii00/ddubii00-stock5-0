import { calculateMA } from './indicators.js';

export const SCAN_MARKETS = {
  kospi: { label: 'KOSPI 전체', benchmark: '^KS11', currency: 'KRW' },
  kosdaq: { label: 'KOSDAQ 전체', benchmark: '^KQ11', currency: 'KRW' },
  nasdaq: { label: 'NASDAQ 전체', benchmark: '^IXIC', currency: 'USD' },
  japan: { label: '일본 도쿄 전체', benchmark: '^N225', currency: 'JPY' },
};

export function normalizeDailyHistory(history) {
  if (!Array.isArray(history)) throw new Error('일봉 자료가 없습니다.');
  const byDate = new Map();
  for (const row of history) {
    const raw = row?.time ?? row?.date;
    const time = raw instanceof Date ? raw.toISOString().slice(0, 10)
      : String(raw || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(time) || !Number.isFinite(row.close) || row.close <= 0) {
      throw new Error('일봉 날짜 또는 종가가 잘못되었습니다.');
    }
    byDate.set(time, { time, close: row.close });
  }
  return [...byDate.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export function weeklyCloses(daily) {
  const weeks = new Map();
  for (const bar of daily) {
    const date = new Date(`${bar.time}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const time = date.toISOString().slice(0, 10);
    weeks.set(time, { time, close: bar.close, lastDate: bar.time });
  }
  return [...weeks.values()];
}

export function scanReference(history) {
  const daily = normalizeDailyHistory(history);
  const weekly = weeklyCloses(daily);
  if (daily.length < 2 || weekly.length < 2) throw new Error('시장의 최근 거래일을 확인할 수 없습니다.');
  return {
    day: { previous: daily.at(-2).time, latest: daily.at(-1).time },
    week: { previous: weekly.at(-2).time, latest: weekly.at(-1).time,
      previousDate: weekly.at(-2).lastDate, latestDate: weekly.at(-1).lastDate },
  };
}

export function crossingDirection(previousClose, previousMA, latestClose, latestMA) {
  const before = previousClose - previousMA;
  const after = latestClose - latestMA;
  if (before <= 0 && after >= 0 && (before < 0 || after > 0)) return 'breakout';
  if (before >= 0 && after <= 0 && (before > 0 || after < 0)) return 'breakdown';
  return null; // Both days exactly on the average are not a crossing.
}

function compareBars(bars, reference, interval) {
  if (bars.length < 201) return { status: 'short-history', available: bars.length };
  const previous = bars.at(-2);
  const latest = bars.at(-1);
  if (previous.time !== reference.previous || latest.time !== reference.latest
    || (interval === 'week' && (previous.lastDate !== reference.previousDate || latest.lastDate !== reference.latestDate))) {
    return { status: 'stale', latestDate: latest.lastDate || latest.time };
  }
  const averages = calculateMA(bars.slice(-201), 200);
  const previousMA = averages.at(-2).value;
  const latestMA = averages.at(-1).value;
  return {
    status: 'ready', signal: crossingDirection(previous.close, previousMA, latest.close, latestMA),
    previous: { date: previous.lastDate || previous.time, close: previous.close, ma200: previousMA },
    latest: { date: latest.lastDate || latest.time, close: latest.close, ma200: latestMA },
    distancePct: (latest.close / latestMA - 1) * 100,
  };
}

export function analyzeMa200History(history, reference) {
  const daily = normalizeDailyHistory(history).filter(bar => bar.time <= reference.day.latest);
  return { day: compareBars(daily, reference.day, 'day'),
    week: compareBars(weeklyCloses(daily), reference.week, 'week') };
}
