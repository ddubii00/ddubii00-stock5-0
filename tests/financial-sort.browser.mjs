// Synthetic financials and isolated local records only.
async page => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const labels = { pe: 'PER', forwardPe: 'F.PER', roe: 'ROE', forwardRoe: 'F.ROE', pbr: 'PBR', peg: 'PEG', marketCap: '시총', revenue: '매출', operatingIncome: '영업이익' };
  await page.context().addInitScript(() => localStorage.setItem('stock5-0-password', 'test-only-password'));
  await page.setViewportSize({ width: 1700, height: 1100 });
  await page.goto('http://127.0.0.1:5179/stock5-0/tests/chart-controls.browser.html?financialSort=1');
  const menu = page.getByLabel('차트 그룹 선택'), rows = page.locator('.scan-table tbody tr');
  await menu.selectOption('common');
  await page.waitForFunction(() => document.querySelector('.scan-progress')?.textContent.includes('공통 조건 검색 완료'), null, { timeout: 45000 });
  check(await page.locator('.common-condition').count() === 3, 'third condition visible by default');
  check(await page.getByLabel('조건 3 지표').inputValue() === '', 'third condition defaults to -');
  const twoCount = await rows.count();
  const activeQuery = await page.request.get('http://127.0.0.1:5179/stock5-0/api/common-scan?conditions='+encodeURIComponent(JSON.stringify([
    { kind: 'line-break', interval: 'day', direction: 'breakout' }, { kind: 'cloud', interval: 'day', direction: 'breakout', target: 'candle' },
  ])), { headers: { 'x-stock5-password': 'test-only-password' } });
  const expected = await activeQuery.json();
  check(twoCount === expected.markets.reduce((n, m) => n + m.results.length, 0), 'default - is omitted from AND query');
  await page.getByLabel('조건 3 지표').selectOption('ma-cross');
  await page.waitForFunction(() => document.querySelector('.scan-progress')?.textContent.includes('공통 조건 검색 완료'), null, { timeout: 30000 });
  check(await rows.count() > 0 && await rows.count() <= twoCount, 'third condition narrows results');
  check(await rows.first().locator('.common-match-cell > div').count() === 3, 'third condition participates');
  await page.getByLabel('조건 3 지표').selectOption('');
  await page.waitForFunction(() => document.querySelector('.scan-progress')?.textContent.includes('공통 조건 검색 완료'), null, { timeout: 30000 });
  check(await rows.count() === twoCount, '- restores two-condition results');
  const waitSorted = async () => page.waitForFunction(() => document.querySelector('.financial-sort-status')?.textContent.includes('미제공 값은 마지막'), null, { timeout: 30000 });
  const checkOrder = async (targetRows, key, descending) => {
    const raw = await targetRows.locator(`[data-financial-key="${key}"]`).allTextContents();
    const numbers = raw.map(text => text.includes('—') ? null : parseFloat(text.replaceAll(',', '')));
    let missing = false, previous = null;
    for (const value of numbers) {
      if (value === null) { missing = true; continue; }
      check(!missing, `${key}: missing values must be last in both directions`);
      if (previous !== null) check(descending ? previous >= value : previous <= value, `${key}: numeric order`);
      previous = value;
    }
  };
  const outputs = [];
  for (const view of ['line-break', 'cloud', 'ma-cross', 'common']) {
    await menu.selectOption(view); await rows.first().waitFor({ timeout: 30000 });
    for (const label of Object.values(labels)) check(await page.getByLabel(`${label} 정렬`, { exact: true }).count() === 1, `${view}: ${label} header`);
    const button = page.getByLabel('PER 정렬', { exact: true });
    check((await button.locator('..').boundingBox()).width <= 72, `${view}: financial header spacing stays compact`);
    await button.click(); await waitSorted(); await checkOrder(rows, 'pe', false);
    if (view === 'line-break') {
      check((await rows.first().locator('.scan-stock-cell small').textContent()) === 'JAPAN27', 'global sort includes stocks originally beyond page one');
    }
    const before = JSON.parse(await page.locator('#financial-api-status').textContent()).requests;
    await button.click(); await waitSorted(); await checkOrder(rows, 'pe', true);
    check(JSON.parse(await page.locator('#financial-api-status').textContent()).requests === before, 'direction toggle reuses existing financials');
    if (view === 'line-break') {
      for (const [key, label] of Object.entries(labels).filter(([key]) => key !== 'pe')) {
        const header = page.getByLabel(`${label} 정렬`, { exact: true });
        await header.click(); await waitSorted(); await checkOrder(rows, key, false);
        await header.click(); await waitSorted(); await checkOrder(rows, key, true);
      }
      await page.getByRole('button', { name: '정렬 해제', exact: true }).click();
      check(await page.locator('.financial-sort-status').count() === 0, 'clear returns original scanner order');
    }
    outputs.push(view);
  }
  await page.evaluate(async () => {
    for (const [symbol, status] of [['SORT120', 'long-hold'], ['SORT122', 'long-hold'], ['SORT124', 'long-hold'], ['SORT130', 'long-watch'], ['SORT132', 'long-watch'], ['SORT134', 'long-watch']]) {
      const r = await fetch('/stock5-0/api/state', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-stock5-password': 'test-only-password' },
        body: JSON.stringify({ symbol, changes: { name: `SORT검증 ${symbol}`, status } }) });
      if (!r.ok) throw new Error('synthetic setup failed');
    }
  });
  await page.reload(); await menu.selectOption('saved-stocks');
  await page.getByLabel('저장 종목명 또는 코드').fill('SORT검증');
  await page.getByLabel('PER 정렬', { exact: true }).first().click(); await waitSorted();
  check((await page.getByLabel('PER 정렬', { exact: true }).first().locator('..').boundingBox()).width <= 66, 'saved financial headers never stretch to fill a wide screen');
  const hold = page.locator('.saved-stock-group[aria-label="롱 보유"] tbody tr');
  const watch = page.locator('.saved-stock-group[aria-label="롱 관심"] tbody tr');
  check(await hold.count() === 3 && await watch.count() === 3, 'saved groups never merge during sort');
  await checkOrder(hold, 'pe', false); await checkOrder(watch, 'pe', false);
  await page.getByLabel('PER 정렬', { exact: true }).last().click(); await waitSorted();
  await checkOrder(hold, 'pe', true); await checkOrder(watch, 'pe', true);
  check((await hold.first().locator('.scan-stock-cell small').textContent()) === 'SORT120', 'saved group numeric descending');
  check((await hold.first().locator('.position-mini-controls button').allTextContents()).join('|') === '준비!|주의!|삭제', 'saved controls preserved');
  check(JSON.parse(await page.locator('#financial-api-status').textContent()).maximum <= 2, 'provider concurrency remains bounded');
  await page.screenshot({ path: '.playwright-mcp/saved-financial-sort.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile horizontal scroll stays inside tables');
  await page.setViewportSize({ width: 1700, height: 1100 });
  return { optionalThird: true, sortableMenus: [...outputs, 'saved-stocks'], allNineMetrics: true, bothDirections: true, globalPagination: true, savedGroupsPreserved: true, missingLast: true, boundedConcurrency: true, mobile: true };
}
