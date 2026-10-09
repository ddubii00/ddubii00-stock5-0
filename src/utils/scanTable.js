export function scanStockLabel(name) {
  const characters = Array.from(String(name ?? ''));
  return characters.length <= 15 ? characters.join('') : `${characters.slice(0, 14).join('')}…`;
}
