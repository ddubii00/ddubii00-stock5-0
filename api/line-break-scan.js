import { createScanHandler, scanner } from './ma200-scan.js';

// Share the same job, provider concurrency limit, history and checkpoint as
// MA200; opening both menus must not start two full-market scans.
export default createScanHandler(scanner, undefined, undefined, 'line-break');
