// Isolated fixture only: exercise persistence, reset failures, and flags-only groups.
async page => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const url = 'http://127.0.0.1:5179/stock5-0/tests/chart-controls.browser.html';
  await page.context().addInitScript(() => localStorage.setItem('stock5-0-password', 'test-only-password'));
  await page.goto(url);
  await page.getByLabel('차트 그룹 선택').waitFor();
  await page.evaluate(async () => {
    const records = [
      ['RESETFULL', '삭제 검증', { status: 'long-hold', ready: true, caution: true, averagePrice: 123 }],
      ['ONLYREADY', '준비만 검증', { status: '', ready: true, caution: false }],
      ['ONLYCAUTION', '주의만 검증', { status: '', ready: false, caution: true }],
      ['BOTHFLAGS', '준비주의 검증', { status: '', ready: true, caution: true }],
      ['WITHSTATUS', '롱숏포함 검증', { status: 'short-watch', ready: true, caution: true }],
      ['AVERAGEONLY', '평균가만 검증', { status: '', ready: false, caution: false, averagePrice: 99 }],
    ];
    for (const [symbol, name, changes] of records) {
      const response = await fetch('/stock5-0/api/state', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-stock5-password': 'test-only-password' },
        body: JSON.stringify({ symbol, changes: { name, ...changes } }) });
      if (!response.ok) throw new Error('synthetic reset setup failed');
    }
  });
  await page.reload();
  await page.getByLabel('차트 그룹 선택').selectOption('saved-stocks');
  await page.getByLabel('저장 종목 구분').selectOption('');
  const flagNames = await page.locator('.saved-stock-table tbody tr .scan-stock-cell small').allTextContents();
  for (const symbol of ['ONLYREADY', 'ONLYCAUTION', 'BOTHFLAGS']) check(flagNames.includes(symbol), `${symbol} appears in flags-only list`);
  check(!flagNames.includes('WITHSTATUS') && !flagNames.includes('RESETFULL') && !flagNames.includes('AVERAGEONLY'), 'flags-only excludes classified and average-only records');
  await page.getByLabel('저장 종목 구분').selectOption('all');
  await page.getByLabel('저장 종목명 또는 코드').fill('RESETFULL');
  const target = page.locator('.saved-stock-table tbody tr').filter({ hasText: 'RESETFULL' });
  check(await target.count() === 1, 'full position visible before reset');
  check((await target.locator('.position-mini-controls button').allTextContents()).join('|') === '준비!|주의!|삭제', 'reset button placement');
  const context = await page.context().browser().newContext();
  try {
    await context.addInitScript(() => localStorage.setItem('stock5-0-password', 'test-only-password'));
    const other = await context.newPage(); await other.goto(url);
    await other.getByLabel('차트 그룹 선택').selectOption('saved-stocks');
    await other.getByLabel('저장 종목명 또는 코드').fill('RESETFULL');
    check(await other.locator('.saved-stock-table tbody tr').count() === 1, 'other device initially sees full record');
    await page.goto(`${url}?save=fail`);
    await page.getByLabel('차트 그룹 선택').selectOption('saved-stocks');
    await page.getByLabel('저장 종목명 또는 코드').fill('RESETFULL');
    await target.getByRole('button', { name: '삭제', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '저장 실패' }).waitFor();
    check(await target.count() === 1, 'failed reset retains the row');
    check(await target.getByRole('button', { name: '준비!', exact: true }).getAttribute('aria-pressed') === 'true', 'failed reset retains flags');
    await page.goto(`${url}?saveDelay=450`);
    await page.getByLabel('차트 그룹 선택').selectOption('saved-stocks');
    await page.getByLabel('저장 종목명 또는 코드').fill('RESETFULL');
    await target.getByRole('button', { name: '삭제', exact: true }).click();
    check(await target.count() === 1, 'row remains until server confirms reset');
    await target.waitFor({ state: 'detached' });
    const records = await page.evaluate(async () => (await (await fetch('/stock5-0/api/state', { headers: { 'x-stock5-password': 'test-only-password' } })).json()).positions);
    check(!records.RESETFULL, 'reset removes persistent record including average price');
    check(records.WITHSTATUS?.status === 'short-watch' && records.WITHSTATUS?.caution === true, 'other positions remain untouched');
    await other.reload();
    await other.getByLabel('차트 그룹 선택').selectOption('saved-stocks');
    await other.getByLabel('저장 종목명 또는 코드').fill('RESETFULL');
    check(await other.locator('.saved-stock-table tbody tr').count() === 0, 'other device sees deletion');
    await page.reload();
    await page.getByLabel('차트 그룹 선택').selectOption('saved-stocks');
    await page.getByLabel('저장 종목명 또는 코드').fill('RESETFULL');
    check(await page.locator('.saved-stock-table tbody tr').count() === 0, 'deleted record stays absent after reload');
    await page.getByLabel('저장 종목 구분').selectOption('');
    await page.getByLabel('저장 종목명 또는 코드').fill('ONLYREADY');
    const readyOnly = page.locator('.saved-stock-table tbody tr').filter({ hasText: 'ONLYREADY' });
    await readyOnly.getByRole('button', { name: '삭제', exact: true }).click();
    await readyOnly.waitFor({ state: 'detached' });
    check(await page.locator('.saved-stock-group').count() === 1, 'flags-only section stays visible when empty');
    check((await page.locator('.saved-stock-group').textContent()).includes('0종목'), 'flags-only empty count is clear');
    // Resetting saved records does not remove the controls from ordinary charts.
    await page.getByLabel('차트 그룹 선택').selectOption('kospi100');
    await page.locator('.position-mini-controls').first().waitFor();
    check((await page.locator('.position-mini-controls').first().locator('button').allTextContents()).length === 6, 'ordinary charts retain all six toggles');
  } finally { await context.close(); }
  return { resetOrder: true, flagsOnly: true, failureRetainsRecord: true, waitsForServer: true, persistedRemoval: true, flagsOnlyDelete: true, otherStocksPreserved: true, otherDevice: true };
}
