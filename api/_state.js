import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';

const KEY = 'stock5-0:chart-positions';
const EMPTY = { positions: {} };
const VALID_STATUS = new Set(['long-hold', 'long-watch', 'short-watch', 'short-hold']);
const password = () => process.env.STOCK5_PASSWORD || '1222';

export function authorized(req) {
  return String(req.headers['x-stock5-password'] || '') === password();
}

function cleanPosition(symbol, value) {
  const status = VALID_STATUS.has(value?.status) ? value.status : '';
  const caution = value?.caution === true;
  const ready = value?.ready === true;
  const average = Number(value?.averagePrice);
  const averagePrice = Number.isFinite(average) && average > 0 ? average : null;

  if (!status && !caution && !ready && averagePrice == null) return null;

  return {
    symbol: String(symbol || '').slice(0, 40),
    name: String(value?.name || '').slice(0, 120),
    status,
    caution,
    ready,
    averagePrice,
    updatedAt: String(value?.updatedAt || new Date().toISOString()).slice(0, 40),
  };
}

function clean(value) {
  const positions = {};
  const entries = Object.entries(value?.positions || {}).slice(0, 600);

  for (const [rawSymbol, rawValue] of entries) {
    const symbol = String(rawSymbol || '').trim().toUpperCase().slice(0, 40);
    if (!symbol) continue;
    const position = cleanPosition(symbol, rawValue);
    if (position) positions[symbol] = position;
  }

  return { positions };
}

async function kv(command) {
  const base = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!base || !token) return null;

  const arrayCommand = Array.isArray(command);
  const response = await fetch(`${base.replace(/\/$/, '')}${arrayCommand ? '' : `/${command}`}`, {
    method: arrayCommand ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(arrayCommand ? { 'Content-Type': 'application/json' } : {}) },
    ...(arrayCommand ? { body: JSON.stringify(command) } : {}),
  });
  if (!response.ok) throw new Error(`공유 저장소 오류 (${response.status})`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error);
  return payload;
}

function filePath() {
  return path.resolve(process.env.STOCK5_DATA_DIR || 'data', 'stock5-0-state.json');
}

export async function loadState() {
  const fromKv = await kv(`get/${encodeURIComponent(KEY)}`);
  if (fromKv) {
    try {
      return clean(JSON.parse(fromKv.result || '{}'));
    } catch {
      throw new Error('기존 공유 기록을 읽지 못했습니다. 저장소를 확인해 주세요.');
    }
  }

  const file = filePath();
  if (!existsSync(file)) return { ...EMPTY, positions: {} };

  try {
    return clean(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    throw new Error('기존 공유 기록 파일을 읽지 못했습니다. 파일을 확인해 주세요.');
  }
}

async function writeState(value) {
  const state = clean(value);
  const encoded = encodeURIComponent(JSON.stringify(state));
  if (await kv(`set/${encodeURIComponent(KEY)}/${encoded}`)) return state;

  const file = filePath();
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
  await rename(temp, file);
  return state;
}

let mutations = Promise.resolve();
function serializeMutation(task) {
  const next = mutations.then(task);
  mutations = next.catch(() => {});
  return next;
}

export function saveState(value) {
  return serializeMutation(() => writeState(value));
}

// Merge only the changed fields in one Redis operation, so two devices updating
// different stocks (or status, caution and ready on one stock) cannot erase each other.
const PATCH_POSITION_LUA = `
local state = cjson.decode(redis.call('GET', KEYS[1]) or '{"positions":{}}')
state.positions = state.positions or {}
local symbol = ARGV[1]
local position = state.positions[symbol] or {}
local changes = cjson.decode(ARGV[2])
for key, value in pairs(changes) do position[key] = value end
position.symbol = symbol
position.updatedAt = ARGV[3]
position.caution = position.caution == true
position.ready = position.ready == true
local active = (type(position.status) == 'string' and position.status ~= '')
  or position.caution or position.ready or (type(position.averagePrice) == 'number' and position.averagePrice > 0)
if active then state.positions[symbol] = position else state.positions[symbol] = nil end
redis.call('SET', KEYS[1], cjson.encode(state))
return cjson.encode(active and position or cjson.null)
`;

export function updatePosition(rawSymbol, changes) {
  const symbol = String(rawSymbol || '').trim().toUpperCase();
  const allowedFields = new Set(['status', 'caution', 'ready', 'averagePrice', 'name']);
  if (!/^[A-Z0-9^][A-Z0-9.^=_-]{0,39}$/.test(symbol)
    || !changes || typeof changes !== 'object' || Array.isArray(changes)
    || Object.keys(changes).some(key => !allowedFields.has(key))
    || ('status' in changes && changes.status !== '' && !VALID_STATUS.has(changes.status))
    || ('caution' in changes && typeof changes.caution !== 'boolean')
    || ('ready' in changes && typeof changes.ready !== 'boolean')
    || ('name' in changes && (typeof changes.name !== 'string' || changes.name.length > 120))
    || ('averagePrice' in changes && changes.averagePrice !== null
      && !(typeof changes.averagePrice === 'number' && Number.isFinite(changes.averagePrice) && changes.averagePrice > 0))) {
    return Promise.reject(Object.assign(new Error('종목 기록 입력이 올바르지 않습니다.'), { status: 400 }));
  }
  return serializeMutation(async () => {
    const updatedAt = new Date().toISOString();
    const result = await kv(['EVAL', PATCH_POSITION_LUA, '1', KEY, symbol, JSON.stringify(changes), updatedAt]);
    if (result) return { symbol, position: cleanPosition(symbol, JSON.parse(result.result)) };

    const state = await loadState();
    const position = cleanPosition(symbol, { ...state.positions[symbol], ...changes, updatedAt });
    if (position) state.positions[symbol] = position;
    else delete state.positions[symbol];
    await writeState(state);
    return { symbol, position };
  });
}
