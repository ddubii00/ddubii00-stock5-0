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

async function loadTop100(market) {
  const suffix = market === 'kosdaq' ? 'KQ' : 'KS';
  const seen = new Set();
  const items = [];

  for (let pageIndex = 0; pageIndex < 5 && items.length < 100; pageIndex += 1) {
    const rows = await fetchPage(market, pageIndex);

    for (const row of rows) {
      const code = String(row?.itemCode || '').trim();
      const name = String(row?.itemName || row?.stockName || row?.name || '').trim();

      if (!/^\d{6}$/.test(code) || !name || seen.has(code)) continue;

      seen.add(code);
      items.push({
        code,
        symbol: `${code}.${suffix}`,
        name,
      });

      if (items.length >= 100) break;
    }

    if (!rows.length) break;
  }

  if (items.length < 100) {
    throw new Error(`Top100 expected 100 unique rows, received ${items.length}`);
  }

  return items.slice(0, 100).map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
}

export default async function handler(req, res) {
  try {
    const market = String(req.query?.market || '').trim().toLowerCase();
    if (market !== 'kospi' && market !== 'kosdaq') {
      return res.status(400).json({ error: 'market must be kospi or kosdaq' });
    }

    const items = await loadTop100(market);

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
