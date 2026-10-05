import { useSyncExternalStore } from 'react';
import { apiUrl } from '../api';

const PASSWORD_KEY = 'stock5-0-password';
let password = '';
let snapshot = { positions: {}, connected: false, loginOpen: false, connecting: false, authError: '', saving: {}, errors: {} };
const listeners = new Set();
let requestVersion = 0;
let writeVersion = 0;
const publish = changes => {
  snapshot = { ...snapshot, ...changes };
  listeners.forEach(listener => listener());
};
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const useSharedPositions = () => useSyncExternalStore(subscribe, () => snapshot);

export const openPositionLogin = () => publish({ loginOpen: true, authError: '' });
export const closePositionLogin = () => publish({ loginOpen: false });

async function stateRequest(method, body, credential = password) {
  const response = await fetch(apiUrl('/state'), {
    method,
    cache: 'no-store',
    headers: { 'x-stock5-password': credential, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    const message = response.status === 401 ? '기존 기록 비밀번호를 확인해 주세요.'
      : payload?.error || `공유 기록 서버 연결 실패 (${response.status})`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return payload;
}

export async function connectSharedPositions(credential) {
  const version = ++requestVersion;
  publish({ connecting: true, authError: '' });
  try {
    const data = await stateRequest('GET', null, credential);
    if (version !== requestVersion) return;
    if (!data.positions || typeof data.positions !== 'object' || Array.isArray(data.positions)) {
      throw new Error('공유 기록 응답이 올바르지 않습니다.');
    }
    password = credential;
    try { localStorage.setItem(PASSWORD_KEY, credential); } catch { /* Server records still persist. */ }
    publish({ positions: data.positions, connected: true, loginOpen: false, authError: '' });
  } catch (error) {
    if (version === requestVersion) publish({ authError: error.message });
  } finally {
    if (version === requestVersion) publish({ connecting: false });
  }
}

function expireAuthentication() {
  password = '';
  try { localStorage.removeItem(PASSWORD_KEY); } catch { /* Storage may be unavailable. */ }
  publish({ connected: false, positions: {}, loginOpen: true, authError: '기존 기록 비밀번호를 확인해 주세요.' });
}

export async function refreshSharedPositions() {
  if (!password || snapshot.connecting || Object.values(snapshot.saving).some(Boolean)) return;
  const version = ++requestVersion;
  const writes = writeVersion;
  try {
    const data = await stateRequest('GET');
    if (version !== requestVersion || writes !== writeVersion) return;
    if (!data.positions || typeof data.positions !== 'object' || Array.isArray(data.positions)) return;
    if (!snapshot.connected || JSON.stringify(data.positions) !== JSON.stringify(snapshot.positions)) {
      publish({ positions: data.positions, connected: true });
    }
  } catch (error) {
    if (version !== requestVersion || writes !== writeVersion) return;
    if (error.status === 401) expireAuthentication();
    else publish({ authError: error.message });
  }
}

export function startSharedPositions() {
  try { password = localStorage.getItem(PASSWORD_KEY) || ''; } catch { /* Ask for login on demand. */ }
  void refreshSharedPositions();
  const refresh = () => { if (!document.hidden) void refreshSharedPositions(); };
  const timer = setInterval(refresh, 15_000);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  return () => {
    clearInterval(timer);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
    requestVersion += 1;
  };
}

export async function saveSharedPosition(rawSymbol, changes) {
  const symbol = String(rawSymbol || '').trim().toUpperCase();
  if (!snapshot.connected) { openPositionLogin(); return; }
  if (snapshot.saving[symbol]) return;
  writeVersion += 1;
  publish({ saving: { ...snapshot.saving, [symbol]: true }, errors: { ...snapshot.errors, [symbol]: '' } });
  try {
    const data = await stateRequest('PATCH', { symbol, changes });
    if (data.symbol !== symbol || !Object.hasOwn(data, 'position')) throw new Error('공유 기록 저장 응답이 올바르지 않습니다.');
    const positions = { ...snapshot.positions };
    if (data.position) positions[symbol] = data.position;
    else delete positions[symbol];
    publish({ positions });
  } catch (error) {
    if (error.status === 401) expireAuthentication();
    publish({ errors: { ...snapshot.errors, [symbol]: `저장 실패: ${error.message}` } });
  } finally {
    writeVersion += 1;
    publish({ saving: { ...snapshot.saving, [symbol]: false } });
  }
}
