import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadForeignRankings, previousCloseMarketCap } from '../api/_foreignRankings.js';
import { parseRankedGroup } from '../src/utils/rankedGroups.js';
import { RANKING_UNIVERSES } from '../src/marketPresets.js';

const directory = async (_market, universe) => ({ items: universe.map(symbol => ({ symbol })) });
const options = universe => ({ universe, directory: market => directory(market, universe) });
const quoteValue = cap => ({ quoteType: 'EQUITY', sharesOutstanding: cap, regularMarketPreviousClose: 1, shortName: `Stock ${cap}` });

test('previous-close ranking never silently substitutes current market cap', () => {
  assert.equal(previousCloseMarketCap({ sharesOutstanding: 100, regularMarketPreviousClose: 2, marketCap: 300 }), 200);
  assert.equal(previousCloseMarketCap({ marketCap: 300, regularMarketPrice: 3, regularMarketPreviousClose: 2 }), 200);
  assert.equal(previousCloseMarketCap({ marketCap: 300 }), null);
  assert.equal(previousCloseMarketCap({ marketCap: Infinity, regularMarketPrice: 3, regularMarketPreviousClose: 2 }), null);
});

test('49 valid Nikkei rows are displayed, not converted into a whole-page error', async () => {
  const universe = Array.from({ length: 50 }, (_, i) => `${i}.T`);
  const result = await loadForeignRankings('nikkei', { ...options(universe), quote: async symbol => {
    if (symbol === '49.T') throw new Error('missing');
    return quoteValue(Number(symbol.split('.')[0]) + 1);
  } });
  assert.equal(result.items.length, 49);
  assert.equal(result.complete, false);
  assert.equal(result.unavailable[0].symbol, '49.T');
  assert.match(result.warning, /50종목 중 49종목/);
  assert.equal(parseRankedGroup(result, 50).items.length, 49);
  assert.equal(result.items[0].symbol, '48.T');
});

test('reserve candidates fill the requested count; official directory excludes delisted candidates', async () => {
  const universe = Array.from({ length: 55 }, (_, i) => `${i}.T`);
  let active = 0, maximum = 0;
  const result = await loadForeignRankings('nikkei', { universe,
    directory: async () => ({ items: universe.slice(1).map(symbol => ({ symbol })) }),
    quote: async symbol => {
      assert.notEqual(symbol, '0.T');
      active++; maximum = Math.max(active, maximum);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return quoteValue(Number(symbol.split('.')[0]) + 1);
    },
  });
  assert.equal(result.items.length, 50);
  assert.equal(result.complete, true);
  assert.equal(maximum, 3);
  assert.deepEqual(result.items.map(x => x.rank), Array.from({ length: 50 }, (_, i) => i + 1));
  assert.equal(result.items[0].symbol, '54.T');
});

test('transient quote errors retry once and missing shares fall back to summary', async () => {
  let calls = 0, summaries = 0;
  const result = await loadForeignRankings('nasdaq', { ...options(['NVDA']),
    quote: async () => { if (++calls === 1) throw new Error('temporary'); return { shortName: 'NVIDIA' }; },
    summary: async () => { summaries++; return { price: { regularMarketPreviousClose: 100 }, defaultKeyStatistics: { sharesOutstanding: 10 } }; },
  });
  assert.equal(calls, 2);
  assert.equal(summaries, 1);
  assert.equal(result.items[0].name, 'NVIDIA');
  assert.equal(result.items.length, 1);
});

test('directory outages are explicit; all-quotes outage still yields a useful retry error', async () => {
  const result = await loadForeignRankings('nasdaq', { universe: ['NVDA'],
    directory: async () => { throw new Error('directory down'); }, quote: async () => quoteValue(10) });
  assert.match(result.warning, /공식 상장 목록/);
  await assert.rejects(loadForeignRankings('nasdaq', { ...options(['NVDA']), quote: async () => { throw new Error('down'); } }), /다시 시도/);
});

test('front-end rejects empty or malformed lists but accepts partial valid lists', () => {
  for (const payload of [{}, { items: [] }, { items: [{ symbol: 'NVDA' }] },
    { items: [{ symbol: 'NVDA', name: 'NVIDIA' }, { symbol: 'NVDA', name: 'Duplicate' }] }]) {
    assert.throws(() => parseRankedGroup(payload, 100));
  }
  assert.match(parseRankedGroup({ items: [{ symbol: 'NVDA', name: 'NVIDIA' }] }, 100).warning, /100종목 중 1종목/);
  assert.ok(!RANKING_UNIVERSES.nikkei.includes('9613.T'));
  for (const symbol of ['WBA', 'ONT', 'KKR', 'HUBS']) assert.ok(!RANKING_UNIVERSES.nasdaq.includes(symbol));
  assert.ok(new Set(RANKING_UNIVERSES.nasdaq).size > 100);
  assert.ok(new Set(RANKING_UNIVERSES.nikkei).size > 50);
});
