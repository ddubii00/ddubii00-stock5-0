import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

function pickName(value, symbol) {
  return String(value?.longName || value?.shortName || value?.displayName || value?.name || symbol || '').trim();
}

export default async function handler(req, res) {
  const symbol = String(req.query?.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  try {
    let quote = null;
    try {
      quote = await yahooFinance.quote(symbol);
    } catch {
      quote = null;
    }

    let name = pickName(quote, '');
    if (!name || name === symbol) {
      const result = await yahooFinance.search(symbol, { quotesCount: 10 });
      const exact = (result.quotes || []).find((item) => String(item?.symbol || '').toUpperCase() === symbol);
      name = pickName(exact, symbol);
    }

    return res.json({ symbol, name: name || symbol });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
