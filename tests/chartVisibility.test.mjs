import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyGlobalVisibility, toggleChartVisibility } from '../src/utils/chartVisibility.js';

const initial = enabled => ({ globalVisible: enabled, visible: enabled });

test('header BB commands show and hide all chart bands', () => {
  const first = applyGlobalVisibility(initial(false), true);
  const second = applyGlobalVisibility(initial(false), true);
  assert.equal(first.visible, true);
  assert.equal(second.visible, true);
  assert.equal(applyGlobalVisibility(first, false).visible, false);
});

test('a local legend hides its chart even with global BB on and survives unchanged renders', () => {
  const otherChart = initial(true);
  const hidden = toggleChartVisibility(initial(true));
  assert.equal(hidden.visible, false);
  assert.equal(hidden.globalVisible, true);
  assert.equal(applyGlobalVisibility(hidden, true), hidden);
  assert.equal(otherChart.visible, true);
  assert.equal(toggleChartVisibility(hidden).visible, true);
});

test('local bands can be shown while header BB is off', () => {
  const shown = toggleChartVisibility(initial(false));
  assert.equal(shown.visible, true);
  assert.equal(applyGlobalVisibility(shown, false), shown);
});

test('a new global off/on command reapplies to all charts after local exceptions', () => {
  const hidden = toggleChartVisibility(initial(true));
  const disabled = applyGlobalVisibility(hidden, false);
  assert.equal(disabled.visible, false);
  assert.equal(applyGlobalVisibility(disabled, true).visible, true);
});
