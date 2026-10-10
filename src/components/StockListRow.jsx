import PositionButtons from './PositionButtons';
import FundamentalsRow from './FundamentalsRow';
import { useVisibleStock } from '../state/stockResources';
import { scanStockLabel } from '../utils/scanTable';

export default function StockListRow({ stock, onOpen }) {
  const [ref, visible] = useVisibleStock();
  return <tr ref={ref}>
    <td className="scan-stock-cell"><button type="button" className="scan-stock-link" title={stock.name || stock.symbol}
      aria-haspopup="dialog" aria-label={`${stock.name || stock.symbol} 차트 보기`} onClick={() => onOpen(stock)}>{scanStockLabel(stock.name || stock.symbol)}</button>
      <small>{stock.symbol}</small></td>
    <td className="saved-record-cell"><PositionButtons symbol={stock.symbol} name={stock.name} flagsOnly /></td>
    <td className="stock-financial-cell"><FundamentalsRow symbol={visible ? stock.symbol : null} /></td>
  </tr>;
}
