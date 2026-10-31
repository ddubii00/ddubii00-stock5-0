import PositionButtons from './PositionButtons';
import FundamentalsRow from './FundamentalsRow';
import { useVisibleStock } from '../state/stockResources';
import { SCAN_MARKETS } from '../utils/ma200Scan';
import { scanStockLabel } from '../utils/scanTable';

const price = value => Number.isFinite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '—';

export default function ScanResultRow({ row, lineBreak, cloud = false, cross = false, cloudTarget = 'ma20', upSignal, upLabel, downLabel, interval, onOpen }) {
  const [ref, visible] = useVisibleStock();
  const signalClass = row.signal === upSignal ? 'scan-up' : 'scan-down';
  return <tr ref={ref}>
    <td className="scan-stock-cell"><button type="button" className="scan-stock-link" aria-haspopup="dialog" title={row.name} aria-label={`${row.name} 차트 보기`}
      onClick={() => onOpen({ symbol: row.symbol, name: row.name, weekly: interval === 'week' })}>{scanStockLabel(row.name)}</button><small title={row.symbol}>{row.symbol}</small></td>
    <td>{row.marketLabel}<small>{SCAN_MARKETS[row.market].currency}</small></td>
    <td className={signalClass}>{row.signal === upSignal ? upLabel : downLabel}</td>
    <td>{row.latest.date}</td><td>{price(cross ? row.previous.fastMA : cloud && cloudTarget !== 'candle' ? row.previous.ma20 : row.previous.close)}</td>
    {cloud ? <><td>{price(row.previous.cloudLow)} ~ {price(row.previous.cloudHigh)}<small>{row.previous.cloudType === 'positive' ? '양운' : row.previous.cloudType === 'negative' ? '음운' : '동일'}</small></td>
      <td>{price(cloudTarget === 'candle' ? row.latest.close : row.latest.ma20)}</td><td>{price(row.latest.cloudLow)} ~ {price(row.latest.cloudHigh)}<small>{row.latest.cloudType === 'positive' ? '양운' : row.latest.cloudType === 'negative' ? '음운' : '동일'}</small></td></>
      : lineBreak ? <><td>{price(row.latest.close)}</td><td>{row.previous.direction === 'up' ? '양선' : '음선'}</td><td>{price(row.reversalPrice)}</td></>
      : cross ? <><td>{price(row.previous.slowMA)}</td><td>{price(row.latest.fastMA)}</td><td>{price(row.latest.slowMA)}</td></>
      : <><td>{price(row.previous.ma200)}</td><td>{price(row.latest.close)}</td><td>{price(row.latest.ma200)}</td></>}
    <td className={signalClass}>{row.distancePct > 0 ? '+' : ''}{row.distancePct.toFixed(2)}%</td>
    <td className="saved-record-cell"><PositionButtons symbol={row.symbol} name={row.name} /></td>
    <td className="stock-financial-cell"><FundamentalsRow symbol={visible ? row.symbol : null} /></td>
  </tr>;
}
