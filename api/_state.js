import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const KEY = 'stock5-0:chart-positions';
const EMPTY = { positions: {} };
const VALID_STATUS = new Set(['long-hold', 'long-watch', 'short-watch', 'short-hold']);
const password = () => process.env.STOCK5_PASSWORD || '1222';

export function authorized(req) {
  return String(req.headers['x-stock5-password'] || '') === password();
}

function cleanPosition(symbol, value) {
  const status = VALID_STATUS.has(value?.status) ? value.status : '';
  const average = Number(value?.averagePrice);
  const averagePrice = Number.isFinite(average) && average > 0 ? average : null;

  if (!status && averagePrice == null) return null;

  return {
    symbol: String(symbol || '').slice(0, 40),
    name: String(value?.name || '').slice(0, 120),
    status,
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

  const response = await fetch(`${base.replace(/\/$/, '')}/${command}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`공유 저장소 오류 (${response.status})`);
  return response.json();
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
      return { ...EMPTY, positions: {} };
    }
  }

  const file = filePath();
  if (!existsSync(file)) return { ...EMPTY, positions: {} };

  try {
    return clean(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return { ...EMPTY, positions: {} };
  }
}

export async function saveState(value) {
  const state = clean(value);
  const encoded = encodeURIComponent(JSON.stringify(state));
  if (await kv(`set/${encodeURIComponent(KEY)}/${encoded}`)) return state;

  const file = filePath();
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
  await rename(temp, file);
  return state;
}
