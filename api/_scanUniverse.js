import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

const NAVER = 'https://stock.naver.com/api/stockSecurity/individual-stocks/v3/domestic';
export const NASDAQ_DIRECTORY = 'https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt';
export const JPX_DIRECTORY = 'https://www.jpx.co.jp/markets/statistics-equities/misc/01.html';
const headers = { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ko-KR,ko;q=0.9' };
async function publicFetch(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`종목 목록 조회 실패 (${response.status})`);
  return response;
}

export function parseNasdaqDirectory(text) {
  const lines = String(text).trim().split(/\r?\n/);
  const headings = lines.shift().split('|');
  for (const required of ['Symbol', 'Security Name', 'Test Issue', 'ETF']) {
    if (!headings.includes(required)) throw new Error('NASDAQ 목록 형식이 변경되었습니다.');
  }
  const items = [];
  const seen = new Set();
  let sourceDate = '';
  for (const line of lines) {
    if (line.startsWith('File Creation Time:')) { sourceDate = line.split('|')[0]; continue; }
    const fields = line.split('|');
    const row = Object.fromEntries(headings.map((key, index) => [key, fields[index]]));
    const symbol = String(row.Symbol || '').replaceAll('.', '-');
    const name = row['Security Name'] || '';
    if (row['Test Issue'] !== 'N' || row.ETF !== 'N' || !/^[A-Z0-9-]{1,15}$/.test(symbol)
      || /\b(?:warrants?|units?|rights?|notes|bonds)\b/i.test(name.split(' - ').at(-1)) || seen.has(symbol)) continue;
    seen.add(symbol);
    items.push({ symbol, name });
  }
  return { items, sourceDate, source: NASDAQ_DIRECTORY };
}

const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const xmlText = value => typeof value === 'object' && value ? String(value['#text'] ?? '') : String(value ?? '');
export function parseJpxWorkbook(bytes) {
  let totalSize = 0;
  const files = unzipSync(bytes, { filter: file => {
    const needed = ['xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml'].includes(file.name);
    if (needed && ((totalSize += file.originalSize) > 16 * 1024 * 1024)) throw new Error('JPX 목록 파일이 너무 큽니다.');
    return needed;
  } });
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
  const readXml = name => {
    const content = files[name] ? strFromU8(files[name]) : '';
    if (/<!DOCTYPE/i.test(content)) throw new Error('JPX XML 형식이 잘못되었습니다.');
    return content ? parser.parse(content) : {};
  };
  const shared = array(readXml('xl/sharedStrings.xml').sst?.si).map(si => si.t != null
    ? xmlText(si.t) : array(si.r).map(r => xmlText(r.t)).join(''));
  const rows = array(readXml('xl/worksheets/sheet1.xml').worksheet?.sheetData?.row).map(row => {
    const result = {};
    for (const cell of array(row.c)) {
      const column = String(cell['@_r'] || '').replace(/\d/g, '');
      result[column] = cell['@_t'] === 's' ? shared[Number(cell.v)]
        : cell['@_t'] === 'inlineStr' ? xmlText(cell.is?.t) : xmlText(cell.v);
    }
    return result;
  });
  const heading = rows.shift() || {};
  const column = name => Object.keys(heading).find(key => heading[key] === name);
  const [codeKey, nameKey, marketKey, dateKey] = ['コード', '銘柄名', '市場・商品区分', '日付'].map(column);
  if (!codeKey || !nameKey || !marketKey || !dateKey) throw new Error('JPX 종목 목록 형식이 변경되었습니다.');
  const items = [], seen = new Set();
  for (const row of rows) {
    const code = String(row[codeKey] || '').trim();
    if (!/^[0-9A-Z]{4}$/.test(code) || !/^(プライム|スタンダード|グロース)（(内国|外国)株式）$/.test(row[marketKey] || '')
      || !row[nameKey] || seen.has(code)) continue;
    seen.add(code);
    items.push({ symbol: `${code}.T`, name: row[nameKey] });
  }
  return { items, sourceDate: rows[0]?.[dateKey] || '', source: JPX_DIRECTORY };
}

async function koreanUniverse(market) {
  const items = [], seen = new Set();
  let expected = null;
  for (let index = 0; index < 100; index++) {
    const params = new URLSearchParams({ listingType: 'marketCapDesc', exchangeType: 'krx',
      marketType: market.toUpperCase(), index: String(index), size: '100' });
    const data = await (await publicFetch(`${NAVER}?${params}`)).json();
    if (expected == null) expected = Number(data.totalCount);
    if (!Array.isArray(data.items) || !Number.isFinite(expected) || expected <= 0) throw new Error('국내 전체 종목 목록 형식이 변경되었습니다.');
    for (const row of data.items) {
      const code = String(row.itemCode || '').trim();
      if (!/^[0-9A-Z]{6}$/.test(code) || !row.itemName || seen.has(code)) continue;
      seen.add(code);
      items.push({ symbol: `${code}.${market === 'kosdaq' ? 'KQ' : 'KS'}`, name: row.itemName });
    }
    if (!data.hasNext) {
      if (items.length !== expected) throw new Error(`국내 전체 목록 불완전: ${items.length}/${expected}`);
      return { items, source: NAVER, sourceDate: new Date().toISOString().slice(0, 10) };
    }
  }
  throw new Error('국내 전체 목록 페이지 한도를 초과했습니다.');
}

export async function loadScanUniverse(market) {
  let result;
  if (market === 'kospi' || market === 'kosdaq') result = await koreanUniverse(market);
  else if (market === 'nasdaq') result = parseNasdaqDirectory(await (await publicFetch(NASDAQ_DIRECTORY)).text());
  else if (market === 'japan') {
    const response = await publicFetch(JPX_DIRECTORY);
    const html = await response.text();
    const path = [...html.matchAll(/href="([^"]+\.xlsx)"/g)].map(match => match[1]).find(value => /data_j\.xlsx$/.test(value));
    if (!path) throw new Error('JPX 공식 종목 파일을 찾지 못했습니다.');
    const url = new URL(path, response.url);
    if (url.hostname !== 'www.jpx.co.jp' || url.protocol !== 'https:') throw new Error('JPX 파일 주소가 잘못되었습니다.');
    const file = await publicFetch(url);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024) throw new Error('JPX 파일 크기 한도 초과');
    result = parseJpxWorkbook(bytes);
  } else throw new Error('지원하지 않는 시장입니다.');
  if (!result.items.length) throw new Error('전체 종목 목록이 비어 있습니다.');
  return result;
}
