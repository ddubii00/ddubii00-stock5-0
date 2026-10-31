import process from 'node:process';
import { scanner } from './ma200-scan.js';
import { authorized } from './_state.js';
import { validateCommonConditions } from '../src/utils/commonScan.js';

export function createCommonScanHandler(service = scanner, isAuthorized = authorized, isServerless = () => process.env.VERCEL === '1') {
  return async (req, res) => {
    if (!isAuthorized(req)) return res.status(401).json({ error: 'invalid password' });
    if (isServerless()) return res.status(503).json({ error: '전체 시장 백그라운드 검색은 Oracle 상시 서버에서 지원합니다.' });
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method not allowed' });
    let conditions;
    try { conditions = validateCommonConditions(JSON.parse(String(req.query?.conditions || 'null'))); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try {
      if (req.method === 'POST' || req.query?.start === '1') await service.start(req.method === 'POST', 'common');
      res.setHeader('Cache-Control', 'no-store');
      return res.json(await service.commonSnapshot(conditions));
    } catch (error) { return res.status(502).json({ error: error.message }); }
  };
}
export default createCommonScanHandler();
