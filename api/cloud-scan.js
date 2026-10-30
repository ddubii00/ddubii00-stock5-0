import { createScanHandler, scanner } from './ma200-scan.js';
import { authorized } from './_state.js';

export function createCloudScanHandler(service = scanner, isAuthorized = authorized, isServerless) {
  const handlers = {
    ma20: createScanHandler(service, isAuthorized, isServerless, 'cloud'),
    candle: createScanHandler(service, isAuthorized, isServerless, 'cloud-candle'),
  };
  return (req, res) => {
    if (!isAuthorized(req)) return res.status(401).json({ error: 'invalid password' });
    const target = String(req.query?.target || 'candle');
    if (!Object.hasOwn(handlers, target)) return res.status(400).json({ error: 'target must be ma20 or candle' });
    return handlers[target](req, res);
  };
}

export default createCloudScanHandler();
