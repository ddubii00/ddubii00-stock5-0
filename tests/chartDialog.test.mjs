import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openChartDialog } from '../src/utils/chartDialog.js';

function fixture() {
  const events = [];
  const style = { overflow: 'auto', scrollbarGutter: '' };
  const doc = { documentElement: { style }, activeElement: { isConnected: true,
    focus: options => events.push(['focus', options]) } };
  const dialog = { open: false, showModal() { this.open = true; events.push('open'); },
    close() { this.open = false; events.push('close'); } };
  return { doc, dialog, events, style };
}

test('chart dialog opens before chart effects, locks background scroll, restores focus and prior styles', () => {
  const { doc, dialog, events, style } = fixture();
  const dispose = openChartDialog(dialog, doc);
  assert.equal(dialog.open, true);
  assert.equal(style.overflow, 'hidden');
  assert.equal(style.scrollbarGutter, 'stable');
  dispose();
  assert.equal(dialog.open, false);
  assert.deepEqual(style, { overflow: 'auto', scrollbarGutter: '' });
  assert.deepEqual(events, ['open', 'close', ['focus', { preventScroll: true }]]);
  dispose();
  assert.equal(events.length, 3);
});

test('closing after a result button disappears does not focus a detached element', () => {
  const { doc, dialog, events } = fixture();
  const dispose = openChartDialog(dialog, doc);
  doc.activeElement.isConnected = false;
  dialog.open = false;
  dispose();
  assert.deepEqual(events, ['open']);
});

test('failed dialog opening never changes the page scroll styles', () => {
  const { doc, dialog, style } = fixture();
  dialog.showModal = () => { throw new Error('not connected'); };
  assert.throws(() => openChartDialog(dialog, doc), /not connected/);
  assert.deepEqual(style, { overflow: 'auto', scrollbarGutter: '' });
});
