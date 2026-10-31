import { createScanHandler, scanner } from './ma200-scan.js';
import { authorized } from './_state.js';
import { MA_CROSS_PAIRS } from '../src/utils/maCrossScan.js';

export function createMaCrossScanHandler(service = scanner, isAuthorized = authorized, isServerless) {
  const handlers = Object.fromEntries(Object.keys(MA_CROSS_PAIRS).map(pair =>
    [pair, createScanHandler(service, isAuthorized, isServerless, `ma-cross-${pair}`)]));
  return (req, res) => {
    if (!isAuthorized(req)) return res.status(401).json({ error: 'invalid password' });
    const pair = String(req.query?.pair || '5-20');
    if (!Object.hasOwn(handlers, pair)) return res.status(400).json({ error: 'pair must be 5-20, 5-60 or 20-60' });
    return handlers[pair](req, res);
  };
}
export default createMaCrossScanHandler();
