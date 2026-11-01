import PositionButtons from './PositionButtons';
import { FinancialCells } from './FinancialTable';
import { useVisibleStock } from '../state/stockResources';
import { scanStockLabel } from '../utils/scanTable';

export default function StockListRow({ stock, onOpen, financialRecord }) {
  const [ref, visible] = useVisibleStock();
  return <tr ref={ref}>
    <td className="scan-stock-cell"><button type="button" className="scan-stock-link" title={stock.name || stock.symbol}
      aria-haspopup="dialog" aria-label={`${stock.name || stock.symbol} 차트 보기`} onClick={() => onOpen(stock)}>{scanStockLabel(stock.name || stock.symbol)}</button>
      <small>{stock.symbol}</small></td>
    <td className="saved-record-cell"><PositionButtons symbol={stock.symbol} name={stock.name} flagsOnly showReset /></td>
    <FinancialCells symbol={visible ? stock.symbol : null} record={financialRecord} />
  </tr>;
}
