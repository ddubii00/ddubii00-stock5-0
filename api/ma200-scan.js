import process from 'node:process';
import path from 'node:path';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { authorized } from './_state.js';
import { createMa200Scanner } from './_ma200Scanner.js';

const checkpointPath = () => path.resolve(process.env.STOCK5_DATA_DIR || 'data', 'stock5-0-ma200-scan.json');
const scanner = createMa200Scanner({
  readCheckpoint: async () => {
    try { return JSON.parse(await readFile(checkpointPath(), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  },
  writeCheckpoint: async data => {
    const file = checkpointPath();
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(data), 'utf8');
    await rename(temp, file);
  },
});

export function createScanHandler(service = scanner, isAuthorized = authorized, isServerless = () => process.env.VERCEL === '1') {
  return async (req, res) => {
    if (!isAuthorized(req)) return res.status(401).json({ error: 'invalid password' });
    if (isServerless()) return res.status(503).json({ error: '전체 시장 백그라운드 검색은 Oracle 상시 서버에서 지원합니다.' });
    const interval = String(req.query?.interval || 'day');
    if (!['day', 'week'].includes(interval)) return res.status(400).json({ error: 'interval must be day or week' });
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method not allowed' });
    try {
      if (req.method === 'POST' || req.query?.start === '1') await service.start(req.method === 'POST');
      res.setHeader('Cache-Control', 'no-store');
      return res.json(await service.snapshot(interval));
    } catch (error) { return res.status(502).json({ error: error.message }); }
  };
}
export default createScanHandler();
