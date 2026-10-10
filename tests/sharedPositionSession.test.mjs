import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const originals = Object.fromEntries(['window', 'document', 'localStorage', 'fetch'].map(key => [key, globalThis[key]]));
after(() => {
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
});

let sessionId = 0;
async function session(savedPassword = '') {
  const storage = new Map(savedPassword ? [['stock5-0-password', savedPassword]] : []);
  const requests = [];
  const positions = { TEST1: { name: '검증 종목 1', status: 'long-hold', caution: true } };
  globalThis.window = { location: { pathname: '/stock5-0/' }, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  globalThis.localStorage = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    if (options.headers['x-stock5-password'] !== 'test-only-password') {
      return Response.json({ error: 'invalid password' }, { status: 401 });
    }
    if (options.method === 'PATCH') {
      const { symbol, changes } = JSON.parse(options.body);
      positions[symbol] = { ...positions[symbol], ...changes };
      return Response.json({ symbol, position: positions[symbol] });
    }
    return Response.json({ positions });
  };
  const state = await import(`../src/state/sharedPositions.js?test-session=${++sessionId}`);
  return { state, storage, requests, positions };
}

test('entering the password loads server records and subsequent button changes save automatically', async () => {
  const { state, storage, requests, positions } = await session();
  const stop = state.startSharedPositions();
  try {
    await state.saveSharedPosition('TEST1', { caution: false });
    assert.equal(requests.length, 0, 'no writes are allowed before login');
    await state.connectSharedPositions('test-only-password');
    assert.equal(requests[0].method, 'GET');
    assert.equal(storage.get('stock5-0-password'), 'test-only-password');
    await state.saveSharedPosition('TEST1', { caution: false });
    assert.equal(requests[1].method, 'PATCH');
    assert.equal(positions.TEST1.status, 'long-hold');
    assert.equal(positions.TEST1.caution, false);
  } finally { stop(); }
});

test('a saved password automatically reloads server records before saving is enabled', async () => {
  const { state, requests, positions } = await session('test-only-password');
  const stop = state.startSharedPositions();
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    await state.saveSharedPosition('TEST1', { status: 'short-hold' });
    assert.equal(requests[1].method, 'PATCH');
    assert.equal(positions.TEST1.status, 'short-hold');
    assert.equal(positions.TEST1.caution, true);
  } finally { stop(); }
});

test('an invalid saved password prevents writes, and entering the correct password restores saving', async () => {
  const { state, requests, storage } = await session('wrong-password');
  const stop = state.startSharedPositions();
  try {
    await new Promise(resolve => setImmediate(resolve));
    await state.saveSharedPosition('TEST1', { status: 'short-hold' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    await state.connectSharedPositions('test-only-password');
    await state.saveSharedPosition('TEST1', { status: 'short-hold' });
    assert.deepEqual(requests.map(request => request.method), ['GET', 'GET', 'PATCH']);
    assert.equal(storage.get('stock5-0-password'), 'test-only-password');
  } finally { stop(); }
});

test('ready changes use field-only PATCH and preserve existing long/short/caution records', async () => {
  const { state, requests, positions } = await session('test-only-password');
  const stop = state.startSharedPositions();
  try {
    await new Promise(resolve => setImmediate(resolve));
    await state.saveSharedPosition('TEST1', { ready: true });
    assert.deepEqual(JSON.parse(requests[1].body), {symbol:'TEST1',changes:{ready:true}});
    assert.equal(positions.TEST1.ready, true);
    assert.equal(positions.TEST1.status, 'long-hold');
    assert.equal(positions.TEST1.caution, true);
    await state.saveSharedPosition('TEST1', { ready: false });
    assert.equal(positions.TEST1.ready, false);
    assert.equal(positions.TEST1.caution, true);
  } finally { stop(); }
});
