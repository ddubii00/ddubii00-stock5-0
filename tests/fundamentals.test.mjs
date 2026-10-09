import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseKoreanFundamentals, parseYahooFundamentals, createFundamentalsHandler } from '../api/fundamentals.js';
import { fundamentalMetrics } from '../src/utils/fundamentalMetrics.js';

test('Korean annual actuals and forward consensus remain separate; EPS-based PEG is marked estimated', () => {
  const values = { 매출액: [10000, 15000], 영업이익: [-200, 300], ROE: [-5, 12], EPS: [100, 150], PER: [12, 8], PBR: [1.2, 1.1] };
  const data = parseKoreanFundamentals('005930.KS', { totalInfos: [{ code: 'marketValue', value: '123조 4,567억' }, { code: 'per', value: '10배' }] }, {
    financeInfo: { trTitleList: [{ key: '202512', isConsensus: 'N' }, { key: '202612', isConsensus: 'Y' }],
      rowList: Object.entries(values).map(([title, v]) => ({ title, columns: { 202512: { value: String(v[0]) }, 202612: { value: String(v[1]) } } })) },
  });
  assert.equal(data.pe, 10);
  assert.equal(data.forwardPe, 8);
  assert.equal(data.roe, -.05);
  assert.equal(data.forwardRoe, .12);
  assert.equal(data.peg, .2);
  assert.equal(data.pegEstimated, true);
  assert.equal(data.marketCap, 123e12 + 4567e8);
  assert.equal(data.revenue, 1e12);
  assert.equal(data.operatingIncome, -200e8);
});

test('missing or nonnumeric financial fields never become fabricated zeroes or forward ratios', () => {
  const korean = parseKoreanFundamentals('005930.KS', {}, {});
  const overseas = parseYahooFundamentals('EMPTY', { financialData: { returnOnEquity: null }, defaultKeyStatistics: { pegRatio: null } });
  for (const data of [korean, overseas]) {
    for (const key of ['marketCap', 'revenue', 'operatingIncome', 'pe', 'forwardPe', 'roe', 'forwardRoe', 'peg']) assert.equal(data[key], null, key);
    assert.ok(fundamentalMetrics(data).every(metric => metric.value === '—'));
  }
});

test('overseas TTM statement values, PEG, and separate reporting/market currencies are retained', () => {
  const data = parseYahooFundamentals('ABC', { price: { marketCap: 2e12, currency: 'USD' },
    summaryDetail: { trailingPE: 20, forwardPE: 15 }, defaultKeyStatistics: { priceToBook: 3, pegRatio: 1.1 },
    financialData: { financialCurrency: 'JPY', returnOnEquity: .2, totalRevenue: 80e12, operatingMargins: .1 } },
    [{ date: '2025-12-31', totalRevenue: 70e12, operatingIncome: 5e12 }, { date: '2026-06-30', totalRevenue: 75e12, operatingIncome: 6e12 }]);
  assert.equal(data.revenue, 75e12);
  assert.equal(data.operatingIncome, 6e12);
  assert.equal(data.operatingIncomeEstimated, false);
  assert.equal(data.forwardPe, 15);
  assert.equal(data.forwardRoe, null);
  assert.equal(data.peg, 1.1);
  const metrics = fundamentalMetrics(data);
  assert.equal(metrics.find(x => x.key === 'marketCap').value, '2조USD');
  assert.equal(metrics.find(x => x.key === 'revenue').value, '75조JPY');
});

test('forward-only PER is not relabeled as actual PER; estimated operating profit remains marked', () => {
  const data = parseYahooFundamentals('ABC', { summaryDetail: { forwardPE: 15 }, financialData: { totalRevenue: 1e12, operatingMargins: -.1 } });
  const metrics = fundamentalMetrics(data);
  assert.equal(metrics.find(x => x.key === 'pe').value, '—');
  assert.equal(metrics.find(x => x.key === 'forwardPe').value, '15');
  assert.equal(metrics.find(x => x.key === 'operatingIncome').label, '영업이익*');
  assert.equal(data.operatingIncome, -.1e12);
});

test('Yahoo TTM Unix dates are normalized; malformed or empty newer rows are ignored', () => {
  const timestamp = Date.parse('2026-06-30') / 1000;
  const data = parseYahooFundamentals('ABC', {}, [
    { date: 'not-a-date', totalRevenue: 999 },
    { date: Date.parse('2026-09-30') / 1000, trailingEps: 2 },
    { date: timestamp, periodType: 'TTM', totalRevenue: 5e12, operatingIncome: 1e12 },
  ]);
  assert.equal(data.period, '2026-06-30');
  assert.equal(data.revenue, 5e12);
  assert.equal(data.operatingIncome, 1e12);
  assert.equal(data.operatingIncomeEstimated, false);
  assert.equal(parseYahooFundamentals('ABC', {}, {}).period, null);
});

async function request(handler, symbol) {
  const result = { status: 200, headers: {} };
  const response = { status(code) { result.status = code; return this; }, setHeader(key, value) { result.headers[key] = value; }, json(data) { result.data = data; return this; } };
  await handler({ query: { symbol } }, response);
  return result;
}

test('financial requests coalesce per symbol, cache for six hours and never exceed two provider jobs', async () => {
  let calls = 0, active = 0, maximum = 0, now = 1;
  const fetcher = async symbol => {
    calls++; active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return { symbol, marketCap: 1e12 };
  };
  const handler = createFundamentalsHandler({ overseas: fetcher, now: () => now });
  const symbols = ['A', 'A', 'B', 'C', 'D', 'E'];
  const results = await Promise.all(symbols.map(symbol => request(handler, symbol)));
  assert.equal(calls, 5);
  assert.equal(maximum, 2);
  assert.ok(results.every(result => result.status === 200));
  await request(handler, 'A');
  assert.equal(calls, 5);
  now += 6 * 60 * 60 * 1000;
  await request(handler, 'A');
  assert.equal(calls, 6);
});

test('provider failure can be retried and missing data stays unavailable rather than zero', async () => {
  let calls = 0;
  const handler = createFundamentalsHandler({ overseas: async symbol => {
    if (++calls === 1) throw new Error('test provider failure');
    return { symbol, pe: null, marketCap: null };
  } });
  assert.equal((await request(handler, 'EMPTY')).status, 502);
  const retry = await request(handler, 'EMPTY');
  assert.equal(retry.status, 200);
  assert.equal(retry.data.unavailable, true);
});
