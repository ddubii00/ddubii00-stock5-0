import { readFile, writeFile } from 'node:fs/promises';

async function read(path) {
  return readFile(path, 'utf8');
}

async function write(path, text) {
  await writeFile(path, text, 'utf8');
  console.log(`updated: ${path}`);
}

async function patchChartColumn() {
  const path = 'src/components/ChartColumn.jsx';
  let s = await read(path);

  if (s.includes('STOCK5_SEARCH_BUTTONS_LAYOUT_V1')) {
    console.log(`${path}: layout patch already applied`);
    return;
  }

  if (!s.includes('position-mini-controls')) {
    throw new Error(`${path}: position controls not found. Run apply-stock5-0-update.mjs first.`);
  }

  const controlsRegex = /            \{showPositionControls && \(\n              <div className="position-mini-controls" aria-label="종목 분류">[\s\S]*?\n              <\/div>\n            \)\}\n/;
  const match = s.match(controlsRegex);
  if (!match) {
    throw new Error(`${path}: position controls block not found.`);
  }

  const controlsBlock = match[0]
    .replace(/^            /gm, '          ');

  // 기존에는 종목명/현재가 행 안에 있던 버튼을 제거한다.
  s = s.replace(controlsRegex, '');

  const searchLine = '        <StockSearch onSelect={handleSelect} placeholder="종목/지수 검색 (예: 하이닉스, KOSPI, AAPL, S&P500)..." />\n';
  if (!s.includes(searchLine)) {
    throw new Error(`${path}: StockSearch line not found.`);
  }

  const newSearchRow = `        {/* STOCK5_SEARCH_BUTTONS_LAYOUT_V1 */}
        <div className="search-position-row">
          <div className="search-position-search">
            <StockSearch onSelect={handleSelect} placeholder="종목/지수 검색..." />
          </div>
${controlsBlock}        </div>
`;

  s = s.replace(searchLine, newSearchRow);
  await write(path, s);
}

async function patchCss() {
  const path = 'src/index.css';
  let s = await read(path);

  if (s.includes('STOCK5_SEARCH_BUTTONS_LAYOUT_STYLE_V1')) {
    console.log(`${path}: layout CSS already applied`);
    return;
  }

  s += `

/* STOCK5_SEARCH_BUTTONS_LAYOUT_STYLE_V1 */
.search-position-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-width: 0;
}

.search-position-search {
  flex: 1 1 180px;
  min-width: 150px;
}

.search-position-search .search-wrapper {
  width: 100%;
}

.search-position-row .position-mini-controls {
  flex: 0 0 auto;
  margin-left: 0;
  flex-wrap: nowrap;
  gap: 3px;
}

/* 좁은 휴대폰 화면에서는 검색창과 버튼이 겹치지 않도록 두 줄로 전환 */
@media (max-width: 560px) {
  .search-position-row {
    flex-wrap: wrap;
  }

  .search-position-search {
    flex: 1 1 100%;
    min-width: 0;
  }

  .search-position-row .position-mini-controls {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}
`;

  await write(path, s);
}

async function main() {
  await patchChartColumn();
  await patchCss();
  console.log('OK: search box narrowed and position buttons moved to its right');
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
