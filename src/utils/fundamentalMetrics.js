const validNumber = value => typeof value === 'number' && Number.isFinite(value);
const number = (value, digits = 2) => validNumber(value)
  ? value.toLocaleString('ko-KR', { maximumFractionDigits: digits }) : '—';
const percentage = value => validNumber(value) ? `${number(value * 100)}%` : '—';
const trillions = (value, currency) => validNumber(value)
  ? `${number(value / 1e12, 6)}조${currency === 'KRW' ? '원' : currency || ''}` : '—';

export function fundamentalMetrics(data = {}) {
  const actualPe = data.peForward ? null : data.pe;
  return [
    { key: 'pe', label: 'PER', value: number(actualPe), hint: '실적 PER' },
    { key: 'forwardPe', label: 'F.PER', value: number(data.forwardPe), hint: 'Forward PER: 제공처의 예상 PER' },
    { key: 'roe', label: 'ROE', value: percentage(data.roe), hint: '실적 ROE' },
    { key: 'forwardRoe', label: 'F.ROE', value: percentage(data.forwardRoe), hint: 'Forward ROE: 제공처의 예상 ROE. 미제공 시 —' },
    { key: 'pbr', label: 'PBR', value: number(data.pbr), hint: '주가순자산비율' },
    { key: 'peg', label: data.pegEstimated ? 'PEG*' : 'PEG', value: number(data.peg),
      hint: data.pegEstimated ? '추정 PEG = PER ÷ 예상 연간 EPS 성장률(%). 흑자이며 양의 성장률인 경우에만 계산' : '제공처의 PEG. 미제공 시 —' },
    { key: 'marketCap', label: '시총', value: trillions(data.marketCap, data.marketCapCurrency || data.currency), hint: '시가총액 (조 단위, 표시 통화 기준)' },
    { key: 'revenue', label: '매출', value: trillions(data.revenue, data.currency), hint: `매출 (조 단위). 기준: ${data.periodType || '연간'} ${data.period || '미제공'}` },
    { key: 'operatingIncome', label: data.operatingIncomeEstimated ? '영업이익*' : '영업이익', value: trillions(data.operatingIncome, data.currency),
      hint: data.operatingIncomeEstimated ? '영업이익 추정: TTM 매출 × 영업이익률' : `영업이익 (조 단위). 기준: ${data.periodType || '연간'} ${data.period || '미제공'}` },
  ];
}
