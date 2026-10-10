import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { createScanExport, buildScanXlsx, downloadScanXlsx, SCAN_XLSX_MIME } from '../src/utils/scanExport.js';

const row = { name: '삼성전자 전체 이름이 아주 길어도 잘리지 않습니다', symbol: '005930', market: 'kospi', marketLabel: 'KOSPI 전체', signal: 'breakout',
  previous: { date: '2026-10-07', close: 70000, ma200: 70001, direction: 'down' },
  latest: { date: '2026-10-08', close: 71000, ma200: 70123.4567, direction: 'up' }, distancePct: 1.25, reversalPrice: 70100 };
const market = { key: 'kospi', label: 'KOSPI 전체', phase: 'done', completed: 120, total: 120, valid: 112, excludedCount: 8,
  exclusionCounts: { 'short-history': 4, stale: 2, error: 2 }, source: 'synthetic-test-only', sourceDate: '2026-10-09',
  reference: { day: { previous: '2026-10-07', latest: '2026-10-08' }, week: { previous: '2026-09-28', latest: '2026-10-05', previousDate: '2026-10-02', latestDate: '2026-10-08' } } };
const options = { data: { status: 'done', updatedAt: '2026-10-09T22:00:00Z', markets: [market] }, matches: [row], savedAt: new Date('2026-10-09T23:04:05Z') };
const read = model => {
  const files = unzipSync(buildScanXlsx(model));
  for (const [name, bytes] of Object.entries(files)) assert.equal(XMLValidator.validate(strFromU8(bytes)), true, name);
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
  return { files, sheet: name => parser.parse(strFromU8(files[`xl/worksheets/sheet${name}.xml`])).worksheet };
};

test('MA200 export has full names, literal codes, precise prices, typed dates and percent fractions', () => {
  const model = createScanExport(options);
  assert.equal(model.results[1][0], row.name);
  assert.equal(model.results[1][1], '005930');
  assert.equal(model.results[1][10], 70123.4567);
  assert.equal(model.results[1][11].value, 0.0125);
  assert.equal(model.results[1][5].value, Date.parse('2026-10-07') / 86400000 + 25569);
  const { sheet } = read(model);
  const cells = sheet(2).sheetData.row[1].c;
  assert.equal(cells[1]['@_t'], 'inlineStr');
  assert.equal(cells[1].is.t['#text'], '005930');
  assert.equal(cells[10].v, '70123.4567');
  assert.equal(cells[11]['@_s'], '4');
  assert.equal(sheet(2).sheetViews.sheetView.pane['@_topLeftCell'], 'C2');
});

test('exports all matching pages and summary count, including zero results', () => {
  const model = createScanExport({ ...options, matches: Array.from({ length: 112 }, (_, i) => ({ ...row, symbol: `CODE${i}` })) });
  assert.equal(model.results.length, 113);
  assert.equal(read(model).sheet(2).autoFilter['@_ref'], 'A1:L113');
  assert.equal(model.summary.find(r => r[0] === '저장 결과 수')[1], 112);
  const empty = createScanExport({ ...options, matches: [] });
  assert.equal(read(empty).sheet(2).autoFilter['@_ref'], 'A1:L1');
});

test('line-break weekly export has direction and reversal prices, actual trading dates vs week starts', () => {
  const model = createScanExport({ ...options, indicator: 'line-break', interval: 'week', direction: 'bearish', marketFilter: 'kospi',
    matches: [{ ...row, signal: 'bearish', previous: { ...row.previous, date: '2026-10-02' }, distancePct: -1.5 }] });
  assert.equal(model.results[1][4], '음전환');
  assert.equal(model.results[1][9], '음선');
  assert.equal(model.results[1][10], 70100);
  assert.equal(model.results[1][11].value, -0.015);
  assert.match(model.filename, /7_삼선_주봉_kospi_음전환_기준20261008/);
  assert.equal(model.summary[21][9].value, Date.parse('2026-10-02') / 86400000 + 25569);
  assert.equal(model.summary[21][11].value, Date.parse('2026-09-28') / 86400000 + 25569);
  read(model);
});

test('filename and summary disclose filters, incomplete/stale status, KST and per-market dates', () => {
  const search = '=HYPERLINK("https://example.test")/검색 * ? '.repeat(5);
  const model = createScanExport({ ...options, search, data: { ...options.data, status: 'partial', stale: true,
    markets: [market, { ...market, key: 'nasdaq', label: 'NASDAQ 전체', reference: { day: { latest: '2026-10-09' } } }] } });
  assert.match(model.filename, /기준20261008~20261009_일부미완료-이전자료_20261010080405KST.xlsx$/);
  assert.equal(model.summary.find(r => r[0] === '종목명/코드 필터')[1], search);
  assert.ok(new TextEncoder().encode(model.filename).length < 240);
  assert.doesNotMatch(model.filename, /[<>:"/\\|?*]/);
  const { files } = read(model);
  assert.doesNotMatch(strFromU8(files['xl/worksheets/sheet1.xml']), /<f[ >]/);
});

test('missing values stay blank, real zero stays numeric, unsafe XML and formulas remain literal', () => {
  const model = createScanExport({ ...options, matches: [{ ...row, name: '=1+1 <&>\u0001', symbol: '001000',
    distancePct: 0, previous: { date: '2026-02-30', close: 0 }, latest: { date: '', close: NaN } }] });
  assert.equal(model.results[1][5], null);
  assert.equal(model.results[1][7], 0);
  assert.equal(model.results[1][8], null);
  const { files } = read(model);
  const source = strFromU8(files['xl/worksheets/sheet2.xml']);
  assert.match(source, /=1\+1 &lt;&amp;&gt;/);
  assert.doesNotMatch(source, /NaN|undefined|<f[ >]|r="F2"/);
});

test('download only creates a local Blob/anchor with no fetch or filesystem writes', async () => {
  const originals = { document: globalThis.document, fetch: globalThis.fetch, create: URL.createObjectURL, revoke: URL.revokeObjectURL, timer: globalThis.setTimeout };
  let blob, clicked = false, removed = false, revoked = false;
  const link = { click: () => { clicked = true; }, remove: () => { removed = true; } };
  try {
    globalThis.document = { createElement: () => link, body: { appendChild: () => {} } };
    globalThis.fetch = () => { throw new Error('Export must not call server'); };
    URL.createObjectURL = value => { blob = value; return 'blob:local-only'; };
    URL.revokeObjectURL = value => { revoked = value === 'blob:local-only'; };
    globalThis.setTimeout = callback => { callback(); };
    const filename = downloadScanXlsx(options);
    assert.equal(link.download, filename);
    assert.equal(link.href, 'blob:local-only');
    assert.ok(clicked && removed && revoked);
    assert.equal(blob.type, SCAN_XLSX_MIME);
    assert.ok(unzipSync(new Uint8Array(await blob.arrayBuffer()))['xl/workbook.xml']);
  } finally {
    globalThis.document = originals.document; globalThis.fetch = originals.fetch;
    URL.createObjectURL = originals.create; URL.revokeObjectURL = originals.revoke; globalThis.setTimeout = originals.timer;
  }
});

test('no record or invalid saving time fails before downloading', () => {
  assert.throws(() => createScanExport({ matches: [] }), /자료/);
  assert.throws(() => createScanExport({ ...options, savedAt: 'invalid' }), /시각/);
});
