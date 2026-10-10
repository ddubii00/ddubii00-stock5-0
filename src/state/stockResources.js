import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../api.js';

// Deduplicate chart/list requests and keep provider traffic bounded when a
// scanner page contains 100 stocks. Errors have a short retry window.
const entries = new Map(), queue = [];
let active = 0;
function pump() {
  while (active < 2 && queue.length) {
    const task = queue.shift();
    active += 1;
    void task().finally(() => { active -= 1; pump(); });
  }
}
export function stockResource(endpoint, symbol) {
  const key = `${endpoint}:${symbol}`;
  const cached = entries.get(key);
  if (cached && (!cached.done || Date.now() < cached.expires)) return cached.promise;
  const entry = { done: false, expires: Infinity };
  entry.promise = new Promise(resolve => {
    queue.push(async () => {
      try {
        const response = await fetch(apiUrl(`/${endpoint}?symbol=${encodeURIComponent(symbol)}`), {
          signal: AbortSignal.timeout(65000),
          headers: { 'x-stock5-password': localStorage.getItem('stock5-0-password') || '' },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || '종목정보 조회 실패');
        if (data?.symbol !== symbol.toUpperCase()) throw new Error('종목정보 코드가 일치하지 않습니다.');
        entry.expires = Date.now() + 6 * 3600000;
        resolve({ data, error: '' });
      } catch (error) {
        entry.expires = Date.now() + 30000;
        resolve({ data: null, error: error.message });
      } finally { entry.done = true; }
    });
  });
  entries.set(key, entry);
  if (entries.size > 1200) for (const [oldKey, value] of entries) {
    if (value.done && oldKey !== key) { entries.delete(oldKey); break; }
  }
  pump();
  return entry.promise;
}

export function useStockResource(endpoint, symbol) {
  const [record, setRecord] = useState({ key: '', data: null, error: '' });
  const key = `${endpoint}:${symbol}`;
  useEffect(() => {
    if (!symbol) return;
    let stopped = false;
    const update = () => {
      if (!document.hidden) void stockResource(endpoint, symbol).then(value => {
        if (!stopped) setRecord({ key: `${endpoint}:${symbol}`, ...value });
      });
    };
    update();
    const timer = setInterval(update, 60000);
    return () => { stopped = true; clearInterval(timer); };
  }, [endpoint, symbol]);
  return record.key === key ? record : { data: null, error: '' };
}

export function useVisibleStock() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !ref.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '150px', threshold: 0 });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);
  return [ref, visible];
}
