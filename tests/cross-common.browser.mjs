// Only the isolated localhost fixture is used; never mutate production records.
async page => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  await page.context().addInitScript(() => localStorage.setItem('stock5-0-password', 'test-only-password'));
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto('http://127.0.0.1:5179/stock5-0/tests/chart-controls.browser.html');
  const menu = page.getByLabel('차트 그룹 선택'), requests = [];
  page.on('request', request => { if (/\/(ma-cross|common|cloud|line-break)-scan\?/.test(request.url())) requests.push({ url: request.url(), method: request.method() }); });
  await menu.selectOption('ma-cross');
  await page.waitForFunction(() => document.querySelector('.scan-progress')?.textContent.includes('전체 검색 완료'), null, { timeout: 45000 });
  const rows = page.locator('.scan-table tbody tr');
  check(await rows.count() > 0, 'daily cross results');
  for (const pair of ['5-20', '5-60', '20-60']) {
    await page.getByLabel('골든 데드 이평 조합').selectOption(pair);
    await rows.first().waitFor({ timeout: 30000 });
    check((await page.locator('.scan-table th').allTextContents()).includes(`최근 ${pair.split('-')[0]}이평`), `${pair} headers`);
    for (const direction of ['breakout', 'breakdown']) {
      await page.getByLabel('골든 데드 필터').selectOption(direction);
      check(await rows.count() > 0, `${pair} ${direction}`);
      check((await rows.locator('td:nth-child(3)').allTextContents()).every(text => text === (direction === 'breakout' ? '골든크로스' : '데드크로스')), 'cross direction label');
    }
    await page.getByLabel('골든 데드 필터').selectOption('all');
    const before = requests.length;
    await page.locator('.scan-timeframes').getByRole('button', { name: '주', exact: true }).click();
    check(await rows.count() > 0, 'weekly cross results');
    await page.locator('.scan-timeframes').getByRole('button', { name: '일', exact: true }).click();
    check(requests.length === before, 'day/week switch reuses the same bundle without another request');
  }
  await menu.selectOption('common');
  await page.waitForFunction(() => document.querySelector('.scan-progress')?.textContent.includes('공통 조건 검색 완료'), null, { timeout: 30000 });
  check(await rows.count() > 0, 'two-condition common results');
  await page.getByRole('button', { name: '조건 추가', exact: true }).click();
  await page.getByLabel('조건 2 구름 기준').selectOption('ma20');
  await page.getByLabel('조건 2 봉 단위').selectOption('week');
  await page.getByLabel('조건 3 이평 조합').selectOption('20-60');
  await page.waitForFunction(() => document.querySelector('.scan-progress')?.textContent.includes('공통 조건 검색 완료'), null, { timeout: 30000 });
  check(await rows.count() > 0, 'three-way daily/weekly AND');
  check(await rows.first().locator('.common-match-cell > div').count() === 3, 'all three matching conditions shown');
  const code = await rows.first().locator('.scan-stock-cell small').textContent();
  await page.getByLabel('공통 결과 종목명 또는 코드').fill('__no_match__');
  check(await rows.count() === 0, 'common search filter');
  await page.getByLabel('공통 결과 종목명 또는 코드').fill(code);
  check(await rows.count() === 1, 'common code search');
  await page.getByLabel('공통 종목 팝업 봉 단위').selectOption('week');
  await rows.first().locator('.scan-stock-link').click();
  const dialog = page.locator('.scan-chart-dialog[open]');
  await dialog.locator('.position-mini-controls').waitFor();
  check(await dialog.locator('.chart-section').count() === 4, 'common popup four charts');
  check((await dialog.locator('.tf-btn.active').allTextContents()).every(text => text === '주'), 'common popup week selection');
  await dialog.getByRole('button', { name: '차트 팝업 닫기' }).click();
  await page.getByLabel('공통 결과 종목명 또는 코드').fill('');
  const refreshResponse = page.waitForResponse(response => response.url().includes('/common-scan?') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '새로 검색', exact: true }).click();
  await refreshResponse;
  await page.waitForFunction(() => document.querySelector('.scan-progress')?.textContent.includes('공통 조건 검색 완료'), null, { timeout: 45000 });
  const posts = requests.filter(r => r.method === 'POST').length;
  await page.getByLabel('조건 3 방향').selectOption('all');
  await page.waitForFunction(() => document.querySelector('.scan-progress')?.textContent.includes('공통 조건 검색 완료'), null, { timeout: 30000 });
  check(requests.filter(r => r.method === 'POST').length === posts, 'changing conditions never forces a whole-market rescan');
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'common controls/table contained on mobile');
  await page.setViewportSize({ width: 1600, height: 1100 });
  const files = [];
  for (const view of ['line-break', 'cloud']) {
    await menu.selectOption(view);
    if (view === 'cloud') await page.getByLabel('구름돌파 검색 기준').selectOption('ma20');
    await page.getByRole('button', { name: '일·주 엑셀 저장', exact: true }).waitFor();
    await rows.first().waitFor({ timeout: 30000 });
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: '일·주 엑셀 저장', exact: true }).click();
    const download = await downloadEvent;
    check(download.suggestedFilename().includes('일봉+주봉'), 'filename declares both timeframes');
    const path = `.playwright-mcp/qa-${view}.xlsx`;
    await download.saveAs(path);
    files.push({ path, filename: download.suggestedFilename() });
  }
  await menu.selectOption('saved-stocks');
  check(await menu.locator('option:checked').textContent() === '11. 종목들', 'saved menu 11 uses existing records');
  await menu.selectOption('common');
  await page.waitForFunction(() => document.querySelector('.scan-progress')?.textContent.includes('공통 조건 검색 완료'), null, { timeout: 30000 });
  await page.screenshot({ path: '.playwright-mcp/common-scanner.png' });
  return { allThreePairs: true, goldenAndDead: true, bothTimeframes: true, commonAND: true, popupFourCharts: true, mobile: true, bothTimeframeDownloads: files };
}
