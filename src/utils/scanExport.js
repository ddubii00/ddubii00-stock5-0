import { zipSync, strToU8 } from 'fflate';
import { SCAN_MARKETS } from './ma200Scan.js';

export const SCAN_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const signals = { breakout: '돌파', breakdown: '붕괴', bullish: '양전환', bearish: '음전환' };
const statuses = { done: '완료', partial: '일부미완료', running: '진행중', interrupted: '중단-보완중', idle: '준비중' };
const phases = { loading: '목록 준비 중', scanning: '검색 중', done: '완료', error: '오류/미완료' };
// Strip XML 1.0 forbidden control characters from provider/user text.
// eslint-disable-next-line no-control-regex
const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const num = value => Number.isFinite(value) ? value : null;
const dateCell = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value
    ? { value: ms / 86400000 + 25569, style: 3 } : null;
};
const percentCell = value => Number.isFinite(value) ? { value: value / 100, style: 4 } : null;
const kst = value => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '자료 없음';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} KST`;
};
// Filenames cannot contain control characters or platform path separators.
// eslint-disable-next-line no-control-regex
const safeName = value => String(value).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/\s+/g, '-').replace(/[. ]+$/g, '');
const colName = index => {
  let result = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
};

// Use the same filtered matches as the UI, before pagination. No re-fetch or recalculation.
export function createScanExport({ indicator = 'ma200', interval = 'day', direction = 'all', marketFilter = 'all', search = '', data, matches, savedAt = new Date() }) {
  if (!data || !Array.isArray(data.markets) || !Array.isArray(matches)) throw new Error('검색 자료를 받은 뒤 저장하세요.');
  const lineBreak = indicator === 'line-break';
  const title = lineBreak ? '7. 삼선전환도 양전환/음전환' : '6. 200이평 돌파/붕괴';
  const timeframe = interval === 'week' ? '주봉' : '일봉';
  const directionLabel = direction === 'all' ? lineBreak ? '양전환+음전환' : '돌파+붕괴' : signals[direction];
  const markets = data.markets.filter(m => marketFilter === 'all' || m.key === marketFilter);
  const refs = markets.map(m => m.reference?.[interval]?.latestDate || m.reference?.[interval]?.latest).filter(Boolean).sort();
  const dateRange = refs.length ? [...new Set([refs[0], refs.at(-1)])].join('~') : '미확정';
  const status = statuses[data.status] || String(data.status || '자료 없음');
  const savedTime = kst(savedAt);
  if (savedTime === '자료 없음') throw new Error('저장 시각이 잘못되었습니다.');
  const summary = [
    [title, '검색 결과 저장 요약'], ['봉 단위', timeframe],
    ['시장 필터', marketFilter === 'all' ? '전체 시장' : SCAN_MARKETS[marketFilter]?.label || marketFilter],
    ['방향 필터', directionLabel], ['종목명/코드 필터', search || '(없음)'],
    ['저장 범위', '현재 필터에 맞는 모든 페이지의 결과 (차트 이미지 제외)'], ['저장 결과 수', matches.length],
    ['전체 검색 상태', status], ['이전 검색 자료', data.stale ? '예 (갱신 필요)' : '아니오'],
    ['선택 시장 확인 수', markets.reduce((sum, m) => sum + (m.completed || 0), 0)],
    ['선택 시장 대상 수', markets.reduce((sum, m) => sum + (m.total || 0), 0)], ['시장별 최근 거래일 범위', dateRange],
    ['서버 자료 갱신 시각', data.updatedAt ? kst(data.updatedAt) : '자료 없음'], ['기기 다운로드 시각', savedTime],
    ['파일 보관', '접속한 기기에서 생성·다운로드. 엑셀 파일의 서버 저장/업로드 없음.'],
    ['계산 기준', lineBreak ? '종가 삼선전환도: 최근 전환선 3개의 최고/최저 범위를 넘는 새 방향 전환.' : '각 봉까지의 200개 종가 단순평균과 최근 두 봉 종가의 돌파/붕괴 비교.'],
    ['주의', '진행 중·중단·일부 미완료 자료는 전체 시장의 완성된 결과가 아닙니다. 장중 신호 및 진행 중 주봉은 바뀔 수 있습니다.'],
    ['날짜/가격', '결과 날짜는 실제 종가 거래일이며 주 시작일과 다를 수 있습니다. 가격은 각 행 통화의 원 단위입니다.'],
    ['조회 오류', data.error || '(없음)'], [],
    ['시장', '상태', '확인 수', '대상 수', '계산 가능', '제외 수', '이력/전환선 부족', '날짜 불일치', '조회 실패', '이전 종가 거래일', '최근 종가 거래일', '이전 주 시작일', '최근 주 시작일', '목록 출처', '목록 기준일', '시장 오류'],
    ...markets.map(m => {
      const ref = m.reference?.[interval];
      return [m.label || SCAN_MARKETS[m.key]?.label || m.key, phases[m.phase] || m.phase || '', num(m.completed), num(m.total), num(m.valid), num(m.excludedCount),
        num(m.exclusionCounts?.['short-history']), num(m.exclusionCounts?.stale), num(m.exclusionCounts?.error),
        dateCell(ref?.previousDate || ref?.previous), dateCell(ref?.latestDate || ref?.latest),
        interval === 'week' ? dateCell(ref?.previous) : null, interval === 'week' ? dateCell(ref?.latest) : null,
        m.source || '', m.sourceDate || '', m.error || ''];
    }),
  ];
  const headers = ['종목명', '종목 코드', '시장', '통화', '구분', '이전 거래일', '최근 거래일', '이전 종가',
    ...(lineBreak ? ['최근 종가', '이전 방향', '전환 기준가', '기준가 대비'] : ['이전 200이평', '최근 종가', '최근 200이평', '최근 괴리율'])];
  const results = [headers, ...matches.map(row => [row.name, String(row.symbol ?? ''), row.marketLabel || SCAN_MARKETS[row.market]?.label || row.market,
    SCAN_MARKETS[row.market]?.currency || '', signals[row.signal] || row.signal, dateCell(row.previous?.date), dateCell(row.latest?.date), num(row.previous?.close),
    ...(lineBreak ? [num(row.latest?.close), row.previous?.direction === 'up' ? '양선' : row.previous?.direction === 'down' ? '음선' : '', num(row.reversalPrice), percentCell(row.distancePct)]
      : [num(row.previous?.ma200), num(row.latest?.close), num(row.latest?.ma200), percentCell(row.distancePct)])])];
  const query = search.trim() ? `_검색-${safeName(Array.from(search.trim()).slice(0, 8).join(''))}` : '';
  const filename = safeName(`stock5-0_${lineBreak ? '7_삼선' : '6_200이평'}_${timeframe}_${marketFilter === 'all' ? '전체' : marketFilter}_${directionLabel}${query}_기준${dateRange.replace(/-/g, '')}_${status}${data.stale ? '-이전자료' : ''}_${savedTime.replace(/[-: ]/g, '').replace('KST', '')}KST.xlsx`);
  return { filename, title, summary, results };
}

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
function worksheet(rows, widths, summary = false) {
  const lastCol = colName(widths.length - 1);
  const cells = rows.map((row, i) => `<row r="${i + 1}" ht="${summary ? i === 20 ? 48 : i >= 15 && i <= 17 ? 48 : 30 : 42}" customHeight="1">${row.map((raw, j) => {
    if (raw === null || raw === undefined) return '';
    const styled = typeof raw === 'object';
    const value = styled ? raw.value : raw;
    const header = summary ? i === 0 || i === 20 : i === 0;
    const style = header ? 1 : styled ? raw.style : typeof value === 'number' ? (summary ? 0 : 2) : 0;
    const address = `${colName(j)}${i + 1}`;
    return typeof value === 'number' ? `<c r="${address}" s="${style}"><v>${value}</v></c>`
      : `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const merges = summary ? `<mergeCells count="38">${Array.from({ length: 19 }, (_, i) =>
    `<mergeCell ref="A${i + 1}:C${i + 1}"/><mergeCell ref="D${i + 1}:H${i + 1}"/>`).join('')}</mergeCells>` : '';
  return `${declaration}<worksheet xmlns="${ns}"><dimension ref="A1:${lastCol}${rows.length}"/>
    <sheetViews><sheetView workbookViewId="0" showGridLines="0">${summary ? '' : '<pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/>'}</sheetView></sheetViews>
    <sheetFormatPr defaultRowHeight="30"/><cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>
    <sheetData>${cells}</sheetData>${summary ? '' : `<autoFilter ref="A1:${lastCol}${rows.length}"/>`}${merges}</worksheet>`;
}

// Genuine OpenXML, zipped by the existing browser dependency. Inline strings
// preserve leading zeros and keep text starting with '=' literal, not formulas.
export function buildScanXlsx(model) {
  const summary = model.summary.map((row, i) => i < 19 ? [row[0], null, null, row[1]] : row);
  const files = {
    '[Content_Types].xml': `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels': `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${declaration}<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="저장 요약" sheetId="1" r:id="rId1"/><sheet name="검색 결과" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `${declaration}<styleSheet xmlns="${ns}">
      <numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts>
      <fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts>
      <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill></fills>
      <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="5">${[0, 0, 164, 165, 10].map((format, i) => `<xf numFmtId="${format}" fontId="${i === 1 ? 1 : 0}" fillId="${i === 1 ? 2 : 0}" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"${i === 1 ? ' horizontal="center"' : ''}${i < 2 ? ' wrapText="1"' : ''}/></xf>`).join('')}</cellXfs>
      <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    'xl/worksheets/sheet1.xml': worksheet(summary, [18, 16, 16, 16, 16, 16, 18, 18, 18, 20, 20, 20, 20, 38, 22, 38], true),
    'xl/worksheets/sheet2.xml': worksheet(model.results, [38, 20, 24, 10, 14, 18, 18, 20, 20, 20, 20, 18]),
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])), { level: 6 });
}

export function downloadScanXlsx(options) {
  const model = createScanExport(options);
  const bytes = buildScanXlsx(model);
  const url = URL.createObjectURL(new Blob([bytes], { type: SCAN_XLSX_MIME }));
  const link = document.createElement('a');
  link.href = url;
  link.download = model.filename;
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
  return model.filename;
}
