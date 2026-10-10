import { memo, useId, useLayoutEffect, useRef, useState } from 'react';
import ChartColumn from './ChartColumn';
import { openChartDialog } from '../utils/chartDialog';

function StockChartDialog({ stock, showBollinger, globalWeekly, onClose }) {
  // Every scanner popup starts with the same four ordinary charts. Its mode is
  // local to this opening, independent of the app header and scanner indicator.
  const [showLineBreak, setShowLineBreak] = useState(false);
  const dialogRef = useRef(null);
  const bodyRef = useRef(null);
  const cardWidthRef = useRef(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const pageScrollbar = window.innerWidth - document.documentElement.clientWidth;
    const dispose = openChartDialog(dialogRef.current);
    // Measure the same grid track as KOSPI100, rather than inventing a separate
    // popup chart width. Padding, dialog border and scrollbar sit outside it.
    const fitCardWidth = () => {
      const body = bodyRef.current;
      const dialog = dialogRef.current;
      const style = getComputedStyle(body);
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const scrollbar = body.offsetWidth - body.clientWidth;
      // Locking the page removes its scrollbar. Keep the width KOSPI100 uses,
      // including when a short search result itself doesn't need a page bar.
      cardWidthRef.current.parentElement.style.width = `${window.innerWidth - Math.max(pageScrollbar, scrollbar)}px`;
      const border = dialog.offsetWidth - dialog.clientWidth;
      const width = cardWidthRef.current.getBoundingClientRect().width + padding + scrollbar + border;
      dialog.style.width = `${Math.min(window.innerWidth - 4, width)}px`;
    };
    fitCardWidth();
    let frame;
    const resize = () => {
      fitCardWidth();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(bodyRef.current);
    observer.observe(cardWidthRef.current);
    window.addEventListener('resize', fitCardWidth);
    return () => {
      window.removeEventListener('resize', fitCardWidth);
      observer.disconnect(); cancelAnimationFrame(frame); dispose();
    };
  }, []);

  return <>
    <div className="dashboard-grid scan-chart-size-probe" aria-hidden="true"><div ref={cardWidthRef} /></div>
    <dialog ref={dialogRef} className="scan-chart-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="scan-chart-dialog-header">
      <h2 id={titleId}>{stock.name} · 종목 차트</h2>
      <div className="scan-chart-dialog-actions">
        <button type="button" className={`header-bb-button${showLineBreak ? ' active' : ''}`}
          aria-pressed={showLineBreak} onClick={() => setShowLineBreak(enabled => !enabled)}
          title="이 팝업의 삼선전환도 표시/해제 (일목균형표 유지)">삼선</button>
        <button type="button" className="scan-chart-dialog-close" aria-label="차트 팝업 닫기" title="닫기 (Esc)" onClick={onClose}>X</button>
      </div>
    </div>
    <div ref={bodyRef} className="scan-chart-dialog-body">
      <ChartColumn id={`scan-popup-${stock.symbol}`} defaultSymbol={stock.symbol} defaultName={stock.name}
        useStoredSelection={false} showPositionControls autoSize showBollinger={showBollinger}
        showLineBreak={showLineBreak}
        globalWeekly={stock.weekly || globalWeekly} />
    </div>
    </dialog>
  </>;
}

export default memo(StockChartDialog);
