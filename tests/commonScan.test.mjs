import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCommonConditions, intersectScanSnapshots, conditionIndicator, conditionLabel } from '../src/utils/commonScan.js';
import { createCommonScanHandler } from '../api/common-scan.js';

const conditions = [{ kind: 'line-break', interval: 'day', direction: 'breakout' }, { kind: 'cloud', interval: 'week', direction: 'breakdown', target: 'ma20' }, { kind: 'ma-cross', interval: 'day', direction: 'breakout', pair: '5-20' }];
const row = (symbol, signal) => ({ symbol, name: 'same display name', signal, latest: { date: '2026-10-30' } });
const snapshot = results => ({ status: 'done', updatedAt: '2026-10-31T00:00:00Z', markets: [{ key: 'kospi', label: 'KOSPI 전체', total: 3, completed: 3, phase: 'done',
  reference: { day: { latest: '2026-10-30' }, week: { latest: '2026-10-26', latestDate: '2026-10-30' } }, results }] });

test('AND intersection uses each condition\'s timeframe, direction and symbol, not display name', () => {
  const response = intersectScanSnapshots(conditions, [snapshot([row('A', 'bullish'), row('B', 'bullish')]), snapshot([row('A', 'breakdown'), row('B', 'breakout')]), snapshot([row('A', 'breakout'), row('C', 'breakout')])]);
  assert.equal(response.status, 'done'); assert.equal(response.markets[0].results.length, 1);
  assert.equal(response.markets[0].results[0].symbol, 'A');
  assert.equal(response.markets[0].results[0].matches.length, 3);
  assert.deepEqual(conditions.map(conditionIndicator), ['line-break', 'cloud', 'ma-cross-5-20']);
  assert.match(conditionLabel(conditions[1]), /구름 20이평 주봉 하락/);
  assert.match(conditionLabel(conditions[2]), /5\/20.*골든크로스/);
});

test('all directions, empty sets and market keys remain independent', () => {
  const any = conditions.slice(0, 2).map(c => ({ ...c, direction: 'all' }));
  assert.equal(intersectScanSnapshots(any, [snapshot([row('A', 'bearish')]), snapshot([row('A', 'breakout')])]).markets[0].results.length, 1);
  assert.equal(intersectScanSnapshots(any, [snapshot([row('A', 'bullish')]), snapshot([])]).markets[0].results.length, 0);
  const other = snapshot([row('A', 'breakout')]); other.markets[0].key = 'kosdaq';
  assert.equal(intersectScanSnapshots(any, [snapshot([row('A', 'bullish')]), other]).markets[0].results.length, 0);
});

test('incomplete/stale data cannot claim complete results and differing market sessions never join', () => {
  const first = snapshot([row('A', 'bullish')]), second = snapshot([row('A', 'breakdown')]);
  second.markets[0].reference.week.latestDate = '2026-10-29';
  const result = intersectScanSnapshots(conditions.slice(0, 2), [first, second]);
  assert.equal(result.status, 'partial'); assert.equal(result.markets[0].results.length, 0); assert.match(result.markets[0].error, /最近|최근/);
  second.status = 'running'; second.stale = true;
  const pending = intersectScanSnapshots(conditions.slice(0, 2), [first, second]);
  assert.equal(pending.status, 'running'); assert.equal(pending.stale, true);
  first.markets[0].excludedCount = 4; first.markets[0].exclusionCounts = { error: 2 };
  const diagnosed = intersectScanSnapshots(conditions.slice(0, 2), [first, second]);
  assert.equal(diagnosed.markets[0].diagnostics[0].excluded, 4);
  assert.equal(diagnosed.markets[0].diagnostics[0].errors, 2);
});

test('conditions reject malformed kinds/intervals/directions/targets/pairs and unsafe excess input', () => {
  assert.throws(() => validateCommonConditions([]));
  assert.throws(() => validateCommonConditions(Array(9).fill(conditions[0])));
  for (const changed of [{ kind: 'ma200' }, { interval: 'month' }, { direction: 'any' }]) assert.throws(() => validateCommonConditions([{ ...conditions[0], ...changed }, conditions[1]]));
  assert.throws(() => validateCommonConditions([conditions[0], { ...conditions[1], target: 'unknown' }]));
  assert.throws(() => validateCommonConditions([conditions[0], { ...conditions[2], pair: '__proto__' }]));
});

test('common API shares a single authenticated job and does not start it for read-only requests', async () => {
  const calls = [], service = { start: async (...args) => calls.push(args), commonSnapshot: async value => ({ conditions: value, markets: [] }) };
  const handler = createCommonScanHandler(service, req => req.headers.password === 'yes', () => false);
  async function request(start, password = 'yes', query = JSON.stringify(conditions)) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, setHeader() {}, json(data) { this.data = data; return this; } };
    await handler({ method: 'GET', headers: { password }, query: { conditions: query, start } }, res); return res;
  }
  assert.equal((await request(undefined, 'no')).statusCode, 401);
  assert.equal((await request(undefined, 'yes', '{')).statusCode, 400);
  assert.equal((await request()).data.conditions.length, 3); assert.deepEqual(calls, []);
  await request('1'); assert.deepEqual(calls, [[false, 'common']]);
});
