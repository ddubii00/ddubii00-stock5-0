import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { loadState, saveState, updatePosition } from '../api/_state.js';
import handler from '../api/state.js';

const directory = await mkdtemp(path.join(tmpdir(), 'stock5-shared-state-test-'));
const original = { ...process.env };
process.env.STOCK5_DATA_DIR = directory;
process.env.STOCK5_PASSWORD = 'test-only-password';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
after(() => {
  for (const key of ['STOCK5_DATA_DIR', 'STOCK5_PASSWORD', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

async function request(method, body, password = 'test-only-password') {
  const result = { status: 200, headers: {} };
  const res = {
    status(code) { result.status = code; return this; },
    setHeader(key, value) { result.headers[key] = value; },
    json(value) { result.body = value; return this; },
  };
  await handler({ method, body, headers: { 'x-stock5-password': password } }, res);
  return result;
}

test('old records keep their status and average price, caution defaults off', async () => {
  await saveState({ positions: { '005930': { name: '삼성전자', status: 'long-hold', averagePrice: 70000 } } });
  const initial = (await loadState()).positions['005930'];
  assert.equal(initial.caution, false);
  assert.equal(initial.ready, false);
  const { position } = await updatePosition('005930', { caution: true });
  assert.equal(position.status, 'long-hold');
  assert.equal(position.averagePrice, 70000);
  assert.equal(position.caution, true);
  await updatePosition('005930', { caution: false });
  assert.equal((await loadState()).positions['005930'].status, 'long-hold');
});

test('each exclusive status can be set and cleared; caution toggles independently', async () => {
  for (const status of ['long-hold', 'long-watch', 'short-watch', 'short-hold']) {
    assert.equal((await updatePosition('NVDA', { status })).position.status, status);
    assert.equal((await updatePosition('NVDA', { status: '' })).position, null);
  }
  const cautionOnly = (await updatePosition('NVDA', { caution: true })).position;
  assert.equal(cautionOnly.status, '');
  assert.equal(cautionOnly.caution, true);
  await updatePosition('NVDA', { status: 'short-hold' });
  const clearedStatus = (await updatePosition('NVDA', { status: '' })).position;
  assert.equal(clearedStatus.caution, true);
  assert.equal((await updatePosition('NVDA', { caution: false })).position, null);
  assert.equal((await loadState()).positions.NVDA, undefined);
});

test('concurrent field updates merge without erasing another device record', async () => {
  await Promise.all([
    updatePosition('AAPL', { status: 'long-watch' }),
    updatePosition('MSFT', { status: 'short-watch' }),
    updatePosition('AAPL', { caution: true }),
    updatePosition('AAPL', { ready: true }),
  ]);
  const { positions } = await loadState();
  assert.equal(positions.AAPL.status, 'long-watch');
  assert.equal(positions.AAPL.caution, true);
  assert.equal(positions.AAPL.ready, true);
  assert.equal(positions.MSFT.status, 'short-watch');
  assert.equal(positions['005930'].averagePrice, 70000);
});

test('records survive a fresh server process', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import {loadState} from './api/_state.js'; process.stdout.write(JSON.stringify(await loadState()));"],
  { cwd: process.cwd(), env: process.env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const { positions } = JSON.parse(child.stdout);
  assert.equal(positions.AAPL.caution, true);
  assert.equal(positions.AAPL.ready, true);
  assert.equal(positions.MSFT.status, 'short-watch');
});

test('API requires existing password for reading and writing; validates PATCH', async () => {
  assert.equal((await request('GET', undefined, 'wrong')).status, 401);
  assert.equal((await request('PATCH', { symbol: 'AAPL', changes: { caution: false } }, 'wrong')).status, 401);
  const get = await request('GET');
  assert.equal(get.headers['Cache-Control'], 'no-store');
  assert.equal(get.body.positions.AAPL.caution, true);
  assert.equal((await request('PATCH', { symbol: 'AAPL', changes: { caution: 'true' } })).status, 400);
  for (const ready of ['true', 1, null]) {
    assert.equal((await request('PATCH', { symbol: 'AAPL', changes: { ready } })).status, 400);
  }
  assert.equal((await request('PATCH', { symbol: 'AAPL', changes: { ready: false } }, 'wrong')).status, 401);
  assert.equal((await request('PATCH', { symbol: '../file', changes: { caution: true } })).status, 400);
  assert.equal((await request('PATCH', { symbol: 'AAPL', changes: { status: 'unknown' } })).status, 400);
  assert.equal((await request('PATCH', { symbol: 'AAPL', changes: { caution: false } })).body.position.status, 'long-watch');
  assert.equal((await request('PATCH', { symbol: 'AAPL', changes: { ready: false } })).body.position.status, 'long-watch');
});

test('ready-only records persist and toggling off deletes only empty records', async () => {
  const { position } = await updatePosition('READY1', { name: '준비 단독 검증', ready: true });
  assert.equal(position.ready, true);
  assert.equal(position.caution, false);
  assert.equal(position.status, '');
  assert.equal((await loadState()).positions.READY1.ready, true);
  assert.equal((await updatePosition('READY1', { ready: false })).position, null);
  assert.equal((await loadState()).positions.READY1, undefined);
});

test('ready toggles independently of all statuses, caution and average price', async () => {
  for (const status of ['long-hold', 'long-watch', 'short-watch', 'short-hold']) {
    await updatePosition('READY2', { status, caution: true, averagePrice: 120, ready: true });
    const off = (await updatePosition('READY2', { ready: false })).position;
    assert.equal(off.status, status);
    assert.equal(off.caution, true);
    assert.equal(off.averagePrice, 120);
    const on = (await updatePosition('READY2', { ready: true })).position;
    assert.equal(on.ready, true);
    assert.equal((await updatePosition('READY2', { caution: false, status: '', averagePrice: null })).position.ready, true);
  }
  assert.equal((await updatePosition('READY2', { ready: false })).position, null);
});

test('KV atomic merge retains ready-only records and permits boolean clearing', async () => {
  const originalFetch = globalThis.fetch;
  process.env.KV_REST_API_URL = 'https://test.invalid';
  process.env.KV_REST_API_TOKEN = 'test-token';
  try {
    globalThis.fetch = async (url, options) => {
      const command = JSON.parse(options.body);
      assert.equal(command[0], 'EVAL');
      assert.match(command[1], /position.ready = position.ready == true/);
      assert.match(command[1], /or position.caution or position.ready or/);
      const changes = JSON.parse(command[5]);
      return Response.json({ result: JSON.stringify(changes.ready ? {symbol:command[4],ready:true} : null) });
    };
    assert.equal((await updatePosition('READY3', { ready: true })).position.ready, true);
    assert.equal((await updatePosition('READY3', { ready: false })).position, null);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  }
});

test('KV field patch uses one atomic command and propagates storage failures', async () => {
  const originalFetch = globalThis.fetch;
  process.env.KV_REST_API_URL = 'https://test.invalid';
  process.env.KV_REST_API_TOKEN = 'test-token';
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://test.invalid');
      assert.equal(options.method, 'POST');
      const command = JSON.parse(options.body);
      assert.equal(command[0], 'EVAL');
      assert.match(command[1], /redis.call\('SET'/);
      assert.equal(command[4], 'NVDA');
      assert.deepEqual(JSON.parse(command[5]), { caution: true });
      return Response.json({ result: JSON.stringify({ symbol: 'NVDA', caution: true }) });
    };
    assert.equal((await updatePosition('NVDA', { caution: true })).position.caution, true);
    globalThis.fetch = async () => Response.json({ error: 'storage unavailable' });
    await assert.rejects(updatePosition('NVDA', { caution: false }), /storage unavailable/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  }
});

test('corrupt existing record file fails safely without overwriting it', async () => {
  const file = path.join(directory, 'stock5-0-state.json');
  await writeFile(file, '{corrupt', 'utf8');
  await assert.rejects(updatePosition('AAPL', { caution: true }), /기존 공유 기록 파일/);
  assert.equal(await readFile(file, 'utf8'), '{corrupt');
});
