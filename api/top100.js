const NAVER_TOP100_API_URL =
  'https://stock.naver.com/api/stockSecurity/individual-stocks/v3/domestic';

async function fetchPage(market, pageIndex) {
  const params = new URLSearchParams({
    listingType: 'marketCapDesc',
    exchangeType: 'krx',
    marketType: market === 'kosdaq' ? 'KOSDAQ' : 'KOSPI',
    index: String(pageIndex),
    size: '50',
  });

  const response = await fetch(`${NAVER_TOP100_API_URL}?${params.toString()}`, {
    headers: {
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0',
      'Cache-Control': 'no-cache',
    },
  });

  if (!response.ok) {
    throw new Error(`Naver Top100 responded ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.items) ? payload.items : [];
}

export default async function handler(req, res) {
  try {
    const market = String(req.query?.market || '').trim().toLowerCase();
    if (market !== 'kospi' && market !== 'kosdaq') {
      return res.status(400).json({ error: 'market must be kospi or kosdaq' });
    }

    const pages = await Promise.all([
      fetchPage(market, 0),
      fetchPage(market, 1),
    ]);

    const suffix = market === 'kosdaq' ? 'KQ' : 'KS';
    const seen = new Set();
    const items = [];

    for (const row of pages.flat()) {
      const code = String(row?.itemCode || '').trim();
      const name = String(row?.itemName || '').trim();
      if (!/^\d{6}$/.test(code) || !name || seen.has(code)) continue;
      seen.add(code);
      items.push({
        rank: items.length + 1,
        code,
        symbol: `${code}.${suffix}`,
        name,
      });
      if (items.length >= 100) break;
    }

    if (items.length < 100) {
      throw new Error(`Top100 expected 100 rows, received ${items.length}`);
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.status(200).json({
      market,
      count: items.length,
      fetchedAt: new Date().toISOString(),
      items,
    });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
}
