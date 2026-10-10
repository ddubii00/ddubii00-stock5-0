// Run with the isolated state/scanner fixture and Vite on 5179 using test data.
async (page) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const url = 'http://127.0.0.1:5179/stock5-0/tests/chart-controls.browser.html?ready-test=1&saveDelay=450';
  await page.goto(url);
  await page.getByLabel('차트 그룹 선택').selectOption('kospi100');
  const controls = page.locator('.position-mini-controls').first();
  const ready = controls.getByRole('button', {name:'준비!',exact:true});
  const caution = controls.getByRole('button', {name:'주의!',exact:true});
  await ready.waitFor();
  const waitIdle = () => page.waitForFunction(() => document.querySelector('.position-mini-controls')?.getAttribute('aria-busy') === 'false');
  const geometry = () => page.locator('.chart-column').nth(1).evaluate(node => {
    const rect = node.getBoundingClientRect(); return [rect.x, rect.y, rect.width];
  });
  const order = await controls.locator('button').allTextContents();
  check(order.join('|') === '롱 보유|롱 관심|숏 관심|숏 보유|준비!|주의!', 'ready is immediately left of caution');
  for (const button of await controls.locator('button').all()) {
    if (await button.getAttribute('aria-pressed') === 'true') { await button.click(); await waitIdle(); }
  }
  const before = await geometry();
  await ready.click();
  const pending = await geometry();
  await waitIdle();
  const after = await geometry();
  check(JSON.stringify(before) === JSON.stringify(pending) && JSON.stringify(before) === JSON.stringify(after), 'saving does not move neighboring chart');
  check(await ready.getAttribute('aria-pressed') === 'true', 'ready turns on');
  const appearance = await ready.evaluate(node => ({background:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color,
    fontSize:getComputedStyle(node).fontSize,height:node.getBoundingClientRect().height,gap:getComputedStyle(node.parentElement).gap,
    paddingLeft:getComputedStyle(node).paddingLeft,paddingRight:getComputedStyle(node).paddingRight}));
  check(appearance.background === 'rgb(22, 163, 74)', 'active background is green');
  check(appearance.fontSize === '11px' && appearance.height === 22 && appearance.gap === '2px', 'slightly smaller controls preserve text size');
  check(appearance.paddingLeft === '3px' && appearance.paddingRight === '3px', 'reduce only the inner horizontal padding further');
  await caution.click(); await waitIdle();
  check(await ready.getAttribute('aria-pressed') === 'true', 'caution change preserves ready');
  await controls.getByRole('button', {name:'숏 보유',exact:true}).click(); await waitIdle();
  check(await ready.getAttribute('aria-pressed') === 'true', 'short status change preserves ready');
  const context = await page.context().browser().newContext();
  try {
    await context.addInitScript(() => localStorage.setItem('stock5-0-password','test-only-password'));
    const second = await context.newPage();
    await second.goto(url);
    await second.getByLabel('차트 그룹 선택').selectOption('kospi100');
    const remote = second.locator('.position-mini-controls').first().getByRole('button',{name:'준비!',exact:true});
    await remote.waitFor();
    check(await remote.getAttribute('aria-pressed') === 'true', 'separate browser restores server-side ready record');
  } finally { await context.close(); }
  await ready.click(); await waitIdle();
  check(await ready.getAttribute('aria-pressed') === 'false', 'second click turns ready off');
  check(await caution.getAttribute('aria-pressed') === 'true', 'clearing ready preserves caution');
  check(await controls.getByRole('button',{name:'숏 보유',exact:true}).getAttribute('aria-pressed') === 'true', 'clearing ready preserves status');
  await page.reload(); await page.getByLabel('차트 그룹 선택').selectOption('kospi100');
  await ready.waitFor();
  check(await ready.getAttribute('aria-pressed') === 'false', 'off persists after reload');
  return {order,appearance,independentFlags:true,separateBrowserRestored:true,neighborStable:true,offPersisted:true};
}
