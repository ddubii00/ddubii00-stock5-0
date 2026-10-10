import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { createScanExport, buildScanXlsx, downloadScanXlsx, readScanExportColors, SCAN_XLSX_MIME } from '../src/utils/scanExport.js';

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
  return { files, styles: parser.parse(strFromU8(files['xl/styles.xml'])).styleSheet,
    sheet: name => parser.parse(strFromU8(files[`xl/worksheets/sheet${name}.xml`])).worksheet };
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
  assert.equal(cells[11]['@_s'], '9');
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

test('both scanners/day/week preserve screen text colors by signal, not the sign of a number', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  for (const indicator of ['ma200', 'line-break']) for (const interval of ['day', 'week']) {
    const up = indicator === 'ma200' ? 'breakout' : 'bullish';
    const down = indicator === 'ma200' ? 'breakdown' : 'bearish';
    const model = createScanExport({ ...options, indicator, interval, matches: [
      { ...row, signal: up, distancePct: 0 }, { ...row, signal: down, distancePct: 0 },
      { ...row, signal: up, distancePct: -1 }, { ...row, signal: down, distancePct: 1 },
    ] });
    const { sheet, styles } = read(model);
    const color = cell => styles.fonts.font[Number(styles.cellXfs.xf[Number(cell['@_s'])]['@_fontId'])].color['@_rgb'];
    const cells = sheet(2).sheetData.row;
    assert.equal(color(cells[0].c[0]), 'FF1A202C');
    assert.equal(styles.fills.fill[3].patternFill.fgColor['@_rgb'], 'FFF8F9FB');
    for (let i = 1; i < cells.length; i++) {
      assert.equal(color(cells[i].c[0]), 'FF1A73E8');
      assert.equal(color(cells[i].c[1]), 'FF6B7280');
      assert.equal(color(cells[i].c[3]), 'FF6B7280');
      assert.equal(color(cells[i].c[7]), 'FF1A202C');
      const expected = i % 2 === 1 ? 'FFDC2626' : 'FF1565C0';
      assert.equal(color(cells[i].c[4]), expected);
      assert.equal(color(cells[i].c[11]), expected);
      assert.equal(styles.cellXfs.xf[Number(cells[i].c[11]['@_s'])]['@_numFmtId'], '10');
      assert.equal(styles.cellXfs.xf[Number(cells[i].c[5]['@_s'])]['@_numFmtId'], '165');
    }
    for (const [name, hex] of Object.entries({ text: '1A202C', accent: '1A73E8', muted: '6B7280', 'scan-up': 'DC2626', 'scan-down': '1565C0' })) {
      assert.match(css, new RegExp(`--${name}:\\s*#${hex}`, 'i'));
    }
  }
});

test('all exported pages retain signal colors and unknown signals stay neutral', () => {
  const { sheet } = read(createScanExport({ ...options, matches: Array.from({length: 112}, (_, i) => ({...row,signal: i % 2 ? 'breakdown' : 'breakout'})) }));
  assert.equal(sheet(2).sheetData.row[112].c[11]['@_s'], '10');
  const unknown = read(createScanExport({...options,matches:[{...row,signal:'unknown'}]})).sheet(2).sheetData.row[1].c;
  assert.equal(unknown[4]['@_s'], '12');
  assert.equal(unknown[11]['@_s'], '4');
});

test('live table palette accepts CSS hex and RGB colors and rejects unsafe values', () => {
  const original = globalThis.getComputedStyle;
  const header = {};
  const table = { querySelector: () => header };
  try {
    globalThis.getComputedStyle = element => element === header ? { color:'rgb(10, 20, 30)',backgroundColor:'rgb(248, 249, 251)' }
      : { color:'rgb(26, 32, 44)',getPropertyValue: name => ({'--accent':' #abc ', '--muted':'#6b7280', '--scan-up':'rgb(220, 38, 38)', '--scan-down':'rgb(21, 101, 192)'})[name] };
    const model = createScanExport({...options,colors:readScanExportColors(table)});
    assert.deepEqual(model.colors, {text:'1A202C',accent:'AABBCC',muted:'6B7280',up:'DC2626',down:'1565C0',headerText:'0A141E',headerFill:'F8F9FB'});
    assert.deepEqual(readScanExportColors(null), {});
    assert.equal(createScanExport({...options,colors:{up:'bad"/><xml>',down:'rgb(300, 0, 0)'}}).colors.up,'DC2626');
  } finally { globalThis.getComputedStyle = original; }
});
