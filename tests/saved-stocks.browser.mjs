// Synthetic API data and isolated server records only; never run on production.
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const url = 'http://127.0.0.1:5179/stock5-0/tests/chart-controls.browser.html';
  await page.context().addInitScript(() => localStorage.setItem('stock5-0-password', 'test-only-password'));
  await page.goto(url);
  await page.getByLabel('차트 그룹 선택').waitFor();
  const saved = [
    ['NVDA', '엔비디아', 'long-hold', true, true], ['AAPL', '애플', 'long-watch', false, true],
    ['MSFT', '마이크로소프트', 'short-watch', true, false], ['7203.T', '도요타', 'short-hold', false, false],
    ['AMD', 'AMD 준비만', '', true, false],
    ['005930.KS', '삼성전자', 'long-watch', false, true],
    ['247540.KQ', '에코프로비엠', 'short-watch', true, false],
  ];
  await page.evaluate(async rows => {
    for (const [symbol, name, status, ready, caution] of rows) {
      const response = await fetch('/stock5-0/api/state', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-stock5-password': 'test-only-password' },
        body: JSON.stringify({ symbol, changes: { name, status, ready, caution } }) });
      if (!response.ok) throw new Error('synthetic record setup failed');
    }
  }, saved);
  await page.reload();
  await page.getByLabel('차트 그룹 선택').selectOption('ma200');
  await page.locator('.scan-table tbody tr').first().waitFor();
  const row = page.locator('.scan-table tbody tr').first();
  await row.locator('.fundamentals-row b').first().waitFor();
  await page.waitForFunction(() => document.querySelector('.scan-table tbody .fundamentals-row')?.textContent.includes('7.52'));
  const financialText = await row.locator('.fundamentals-row').textContent();
  check(financialText.includes('F.ROE103.18%')
    && financialText.includes('시총1,232조원') && financialText.includes('매출97.1조원') && financialText.includes('영업이익47.2조원'), 'menu6 financial values');
  const singleLine = await row.locator('.fundamentals-metric').evaluateAll(nodes => new Set(nodes.map(node => Math.round(node.getBoundingClientRect().y))).size === 1);
  check(singleLine, 'financial metrics stay on a single line');
  const scannerOrder = '롱 보유|롱 관심|숏 관심|숏 보유|준비!|주의!';
  check((await row.locator('.position-mini-controls button').allTextContents()).join('|') === scannerOrder, 'scanner list restores all status buttons before flags');
  check(await row.locator('td').nth(3).textContent() === '2026-10-08', 'menu6 displays latest date only');
  for (const name of ['롱 보유', '롱 관심', '숏 관심', '숏 보유']) {
    const button = row.getByRole('button', { name, exact: true });
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
    await page.waitForFunction(() => document.querySelector('.scan-table .position-mini-controls')?.getAttribute('aria-busy') === 'false');
    check(await button.getAttribute('aria-pressed') === 'true', `menu6 can select ${name}`);
  }
  await row.locator('.scan-stock-link').click();
  const popupControls = page.locator('.scan-chart-dialog .position-mini-controls');
  check(await popupControls.locator('button').count() === 6, 'popup preserves status buttons');
  const watch = popupControls.getByRole('button', { name: '롱 관심', exact: true });
  if (await watch.getAttribute('aria-pressed') !== 'true') await watch.click();
  await page.waitForFunction(() => document.querySelector('.scan-chart-dialog .position-mini-controls')?.getAttribute('aria-busy') === 'false');
  await page.getByRole('button', { name: '차트 팝업 닫기', exact: true }).click();
  const ready = row.getByRole('button', { name: '준비!', exact: true });
  if (await ready.getAttribute('aria-pressed') !== 'true') await ready.click();
  await page.waitForFunction(() => document.querySelector('.scan-table .position-mini-controls')?.getAttribute('aria-busy') === 'false');
  const scanSymbol = await row.locator('.scan-stock-cell small').textContent();
  await page.getByLabel('차트 그룹 선택').selectOption('line-break');
  await page.locator('.scan-table tbody tr').first().waitFor();
  await page.waitForFunction(() => document.querySelector('.scan-table tbody .fundamentals-row')?.textContent.includes('7.52'));
  const lineRow = page.locator('.scan-table tbody tr').first();
  check((await lineRow.locator('.position-mini-controls button').allTextContents()).join('|') === scannerOrder, 'menu7 restores all status buttons');
  check(await lineRow.locator('td').nth(3).textContent() === '2026-10-08', 'menu7 displays latest date only');
  const lineShort = lineRow.getByRole('button', { name: '숏 관심', exact: true });
  if (await lineShort.getAttribute('aria-pressed') !== 'true') await lineShort.click();
  await page.waitForFunction(() => document.querySelector('.scan-table .position-mini-controls')?.getAttribute('aria-busy') === 'false');
  check(await lineShort.getAttribute('aria-pressed') === 'true', 'menu7 changes shared status');
  await page.getByLabel('차트 그룹 선택').selectOption('saved-stocks');
  check(await page.locator('.saved-stock-group').count() === 5, 'four status groups plus flag-only records');
  const nvda = page.locator('.saved-stock-table tbody tr').filter({ hasText: 'NVDA' });
  await nvda.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.saved-stock-table tbody tr')].find(row => row.textContent.includes('NVDA'))?.textContent.includes('7.52'));
  check((await nvda.locator('.position-mini-controls button').allTextContents()).join('|') === '준비!|주의!|삭제', 'saved list has delete immediately after caution');
  check((await page.locator('.saved-stock-table thead tr').first().textContent()) === '종목준비! / 주의! / 삭제재무정보', 'all four indicator columns removed');
  const headingColors = await page.locator('.saved-group-title').evaluateAll(nodes => nodes.slice(0,4).map(node => getComputedStyle(node).color));
  check(headingColors.join('|') === 'rgb(220, 38, 38)|rgba(220, 38, 38, 0.65)|rgba(21, 101, 192, 0.65)|rgb(21, 101, 192)', 'group headings distinguish all four record colors');
  check(await nvda.getByRole('button', { name: '준비!', exact: true }).getAttribute('aria-pressed') === 'true', 'ready persisted');
  check(await nvda.getByRole('button', { name: '주의!', exact: true }).getAttribute('aria-pressed') === 'true', 'caution persisted');
  check((await nvda.locator('.fundamentals-row').textContent()).includes('PEG*0.01'), 'saved stocks financials');
  check((await page.locator('.saved-stock-table tbody').allTextContents()).some(text => text.includes(scanSymbol)), 'menu6 marking appears in menu8');
  await nvda.getByRole('button', { name: '엔비디아 차트 보기', exact: true }).click();
  await page.locator('.scan-chart-dialog').waitFor();
  check(await page.locator('.scan-chart-dialog-header').getByRole('button', { name: '삼선', exact: true }).getAttribute('aria-pressed') === 'false', 'menu8 popup starts with candles');
  await page.locator('.scan-chart-dialog-header').getByRole('button', { name: '삼선', exact: true }).click();
  await page.getByRole('button', { name: '차트 팝업 닫기', exact: true }).click();
  await page.getByLabel('저장 종목 구분').selectOption('short-hold');
  check(await page.locator('.saved-stock-group').count() === 1 && (await page.locator('.saved-stocks').textContent()).includes('도요타'), 'status filter');
  await page.getByLabel('저장 종목 구분').selectOption('all');
  await page.getByLabel('저장 종목 시장구분').selectOption('japan');
  check(await page.locator('.saved-stock-table tbody tr').count() === 1 && (await page.locator('.saved-stocks').textContent()).includes('도요타'), 'Japan market filter');
  await page.getByLabel('저장 종목 시장구분').selectOption('kospi');
  check(await page.locator('.saved-stock-table tbody tr').count() === 1 && (await page.locator('.saved-stocks').textContent()).includes('삼성전자'), 'KOSPI market filter');
  await page.getByLabel('저장 종목명 또는 코드').fill('NVDA');
  check(await page.locator('.saved-stock-table tbody tr').count() === 0, 'market and query intersect');
  await page.getByLabel('저장 종목 시장구분').selectOption('us');
  check(await page.locator('.saved-stock-table tbody tr').count() === 1, 'US market and symbol query');
  await page.getByLabel('저장 종목명 또는 코드').fill('');
  await page.getByLabel('저장 종목 시장구분').selectOption('kosdaq');
  check(await page.locator('.saved-stock-table tbody tr').count() === 1, 'KOSDAQ market filter');
  await page.getByLabel('저장 종목 구분').selectOption('long-hold');
  check(await page.locator('.saved-stock-table tbody tr').count() === 0, 'market and status intersect');
  await page.getByLabel('저장 종목 구분').selectOption('all');
  await page.getByLabel('저장 종목 시장구분').selectOption('all');
  await page.getByLabel('저장 종목명 또는 코드').fill('NVDA');
  check(await page.locator('.saved-stock-table tbody tr').count() === 1, 'name/code search');
  const wrap = page.locator('.saved-stocks .scan-table-wrap').first();
  await wrap.evaluate(node => { node.scrollLeft = node.scrollWidth; });
  const sticky = await nvda.locator('.scan-stock-cell').evaluate(node => {
    const rect = node.getBoundingClientRect(), parent = node.closest('.scan-table-wrap').getBoundingClientRect();
    return Math.abs(rect.left - parent.left) < 3;
  });
  check(sticky, 'stock name stays visible while scrolling financial columns');
  const context = await page.context().browser().newContext();
  try {
    await context.addInitScript(() => localStorage.setItem('stock5-0-password', 'test-only-password'));
    const other = await context.newPage(); await other.goto(url);
    await other.getByLabel('차트 그룹 선택').selectOption('saved-stocks');
    const remote = other.locator('.saved-stock-table tbody tr').filter({ hasText: 'NVDA' });
    await remote.waitFor();
    check(await remote.getByRole('button', { name: '준비!', exact: true }).getAttribute('aria-pressed') === 'true', 'separate browser sees same records');
  } finally { await context.close(); }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('저장 종목명 또는 코드').fill('');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile table scroll is internal');
  await page.setViewportSize({ width: 1600, height: 1000 });
  return { scannerFinancials: financialText, singleLine, sharedMenu6To8: true, groups: 5, scannerStatusButtons: true, latestDateOnly: true, headingColors, indicatorsRemoved: true, samePopup: true, sticky, separateBrowser: true, mobileInternalScroll: true, combinedMarketFilters: true };
}
