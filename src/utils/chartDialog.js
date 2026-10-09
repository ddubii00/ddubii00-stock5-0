// Native modal dialogs handle the focus trap and make the background inert.
// Open before chart effects run so canvases measure the visible dialog width.
export function openChartDialog(dialog, doc = document) {
  const rootStyle = doc.documentElement.style;
  const previousOverflow = rootStyle.overflow;
  const previousGutter = rootStyle.scrollbarGutter;
  const previousFocus = doc.activeElement;
  dialog.showModal();
  rootStyle.scrollbarGutter = 'stable';
  rootStyle.overflow = 'hidden';
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (dialog.open) dialog.close();
    rootStyle.overflow = previousOverflow;
    rootStyle.scrollbarGutter = previousGutter;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
}
