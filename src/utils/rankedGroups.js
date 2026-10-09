export function parseRankedGroup(payload, expected) {
  const items = Array.isArray(payload?.items) ? payload.items.slice(0, expected) : [];
  const symbols = new Set(items.map(item => item?.symbol));
  if (!items.length || symbols.size !== items.length || items.some(item => !item?.symbol || !item?.name)) {
    throw new Error('유효한 종목 목록을 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return {
    items,
    warning: payload.warning || (items.length < expected ? `${expected}종목 중 ${items.length}종목을 우선 표시합니다. 누락 종목은 다시 조회할 수 있습니다.` : ''),
  };
}
