export const POSITION_GROUPS = [
  ['long-hold', '롱 보유'], ['long-watch', '롱 관심'],
  ['short-watch', '숏 관심'], ['short-hold', '숏 보유'],
];

export function stocksInPositionGroup(stocks, status) {
  return stocks.filter(stock => status ? stock.status === status
    : !stock.status && (stock.ready === true || stock.caution === true));
}
