// Playwright browser regression. Run with the isolated ma200-scan.browser-server
// (test-only password/data directory) and Vite on 5179. No live market API used.
async (page) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  await page.goto('http://127.0.0.1:5179/stock5-0/tests/chart-controls.browser.html?popup-mode=regression');
  const headerToggle = page.locator('.app-header').getByRole('button', {name:'삼선',exact:true});
  if (await headerToggle.getAttribute('aria-pressed') !== 'true') await headerToggle.click();
  const results = [];
  for (const menu of ['ma200','line-break']) {
    await page.getByLabel('차트 그룹 선택').selectOption(menu);
    await page.waitForFunction(() => document.querySelector('.scan-progress')?.textContent.includes('전체 검색 완료'), null, {timeout:45000});
    await page.locator('.scan-stock-link').first().click();
    const dialog = page.locator('.scan-chart-dialog[open]');
    const toggle = dialog.locator('.scan-chart-dialog-header').getByRole('button', {name:'삼선',exact:true});
    await page.waitForTimeout(450); // Initial fixture OHLCV and chart paint.
    check(await dialog.locator('[data-chart-mode="candle"]').count() === 1, `${menu}: ordinary candles on opening`);
    check(await toggle.getAttribute('aria-pressed') === 'false', `${menu}: local mode defaults off despite header on`);
    check(await dialog.locator('.chart-section').count() === 4, `${menu}: same four chart sections`);
    const labels = await dialog.locator('.chart-label').allTextContents();
    check(labels.includes('캔들차트') && labels.includes('MACD (12, 26, 9)'), `${menu}: original candle and MACD labels`);
    const ichi = () => dialog.locator('.chart-section').last().locator('canvas').evaluateAll(nodes => nodes.map(node => node.toDataURL()));
    const originalIchi = await ichi();
    await page.evaluate(() => {
      window.popupTestFetch = window.fetch;
      window.popupTestRequests = [];
      window.fetch = (...args) => { window.popupTestRequests.push(String(args[0])); return window.popupTestFetch(...args); };
    });
    await toggle.click();
    await page.waitForTimeout(150);
    check(await dialog.locator('[data-chart-mode="line-break"]').count() === 1, `${menu}: local button shows line break`);
    check(await dialog.locator('.macd-blank').count() === 1, `${menu}: existing line-break MACD behavior`);
    check(JSON.stringify(await ichi()) === JSON.stringify(originalIchi), `${menu}: Ichimoku canvas unchanged`);
    await toggle.click();
    await page.waitForTimeout(150);
    check(await dialog.locator('[data-chart-mode="candle"]').count() === 1, `${menu}: local button restores candle`);
    check(await dialog.locator('.macd-blank').count() === 0, `${menu}: restores MACD`);
    check(JSON.stringify(await ichi()) === JSON.stringify(originalIchi), `${menu}: original Ichimoku preserved`);
    const requests = await page.evaluate(() => {
      window.fetch = window.popupTestFetch;
      const calls = window.popupTestRequests;
      delete window.popupTestFetch; delete window.popupTestRequests;
      return calls;
    });
    check(!requests.some(url => url.includes('/ohlcv')), `${menu}: toggles do not request more chart data`);
    check(await headerToggle.getAttribute('aria-pressed') === 'true', `${menu}: global header remains on`);
    await toggle.click();
    await dialog.getByRole('button', {name:'차트 팝업 닫기'}).click();
    await page.locator('.scan-stock-link').first().click();
    check(await dialog.locator('.scan-chart-dialog-header').getByRole('button', {name:'삼선',exact:true}).getAttribute('aria-pressed') === 'false', `${menu}: reopen resets local mode`);
    await page.keyboard.press('Escape');
    check(await dialog.count() === 0, `${menu}: Esc closes popup`);
    results.push({menu, labels, toggleRequests:requests.length, initialMode:'candle',reopenMode:'candle',ichimokuUnchanged:true});
  }
  await page.getByRole('button', {name:'주',exact:true}).last().click();
  await page.locator('.scan-stock-link').first().click();
  const weekly = page.locator('.scan-chart-dialog[open]');
  await page.waitForTimeout(150);
  check((await weekly.locator('.tf-btn.active').allTextContents()).every(label => label === '주'), 'weekly result popup starts both charts on week');
  check(await weekly.locator('[data-chart-mode="candle"]').count() === 1, 'weekly popup also starts with ordinary candles');
  await weekly.getByRole('button', {name:'차트 팝업 닫기'}).click();
  return {passed:results,weeklyPreserved:true};
}
