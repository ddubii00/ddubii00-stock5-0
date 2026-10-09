// Isolated development fixture: synthetic prices, real scanner/auth/state handlers.
import express from 'express';
import stateHandler from '../api/state.js';
import { createMa200Scanner } from '../api/_ma200Scanner.js';
import { createScanHandler } from '../api/ma200-scan.js';

const date = new Date('2026-10-08T00:00:00Z');
const bars = [];
while (bars.length < 1250) {
  if (![0, 6].includes(date.getUTCDay())) bars.unshift({ time: date.toISOString().slice(0, 10), close: 100 });
  date.setUTCDate(date.getUTCDate() - 1);
}
const names = { kospi: '코스피', kosdaq: '코스닥', nasdaq: '나스닥', japan: '일본' };
const scanner = createMa200Scanner({
  loadUniverse: async market => ({ source: 'synthetic-test-only', sourceDate: '2026-10-09',
    items: Array.from({ length: 30 }, (_, i) => ({ symbol: `${market.toUpperCase()}${i}`, name: `검증 ${names[market]} 종목 ${i + 1}` })) }),
  loadHistory: async symbol => {
    await new Promise(resolve => setTimeout(resolve, 100));
    const rows = bars.map(bar => ({ ...bar }));
    if (!symbol.startsWith('^')) {
      if (symbol.endsWith('29')) return rows.slice(-150);
      if (symbol.endsWith('28')) return rows.slice(0, -1);
      const up = Number(symbol.match(/\d+$/)?.[0]) % 2 === 0;
      rows.at(-2).close = up ? 90 : 110;
      rows.at(-1).close = up ? 110 : 90;
    }
    return rows;
  },
});
const app = express();
app.use(express.json());
app.all('/api/state', stateHandler);
app.all('/api/ma200-scan', createScanHandler(scanner));
app.listen(3001, '127.0.0.1', () => console.log('Isolated MA200 browser fixture listening on 3001'));
