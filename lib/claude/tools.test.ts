import { test, expect, describe } from 'bun:test';
import {
  TOOLS,
  MAX_TOOL_ITERATIONS,
  dispatchTool,
  toToolResult,
  computeBtctcMovers,
  type ToolDeps,
} from './tools';
import type { FundSummary } from '../terminal/summary';
import type { Positions, PositionByTicker } from '../terminal/positions';
import type { Btctc, BtctcCompany, BtctcCompanyResult } from '../terminal/btctc';
import type { OnChain } from '../terminal/on-chain';

const summary: FundSummary = {
  asOf: '2026-06-22T20:00:00.000Z',
  fund: { aumUsd: 94638882, change1dPct: -1.3, mtdPct: -4.2, ytdPct: -16.18, cashUsd: 4366855, asOfDate: '2026-06-22' },
  btc: { priceUsd: 64414.64, change1dPct: -0.85, mtdPct: -12.54 },
  topHoldings: [
    { name: 'MicroStrategy', ticker: 'MSTR', weightPercent: 18.5, change1dPct: -2.1 },
  ],
};

const positions: Positions = {
  asOf: '2026-06-22T22:00:00.000Z',
  holdings: [
    { name: 'MicroStrategy', ticker: 'MSTR', weightPercent: 18.5, change1dPct: -2.1 },
    { name: 'Metaplanet', ticker: 'MTPLF', weightPercent: 9.2, change1dPct: 3.4 },
  ],
};

const positionFound: PositionByTicker = {
  asOf: '2026-06-22T22:00:00.000Z',
  ticker: 'MSTR',
  name: 'MicroStrategy',
  found: true,
  position: { weightPercent: 18.5, valueUsd: 17500000, quantity: 12345, change1dPct: -2.1 },
  ownership: {
    ownershipPercent: 1.23,
    sharesHeld: 12345,
    basicShares: 1000000,
    attributionConfigured: false,
  },
};

const btctcCompanies: BtctcCompany[] = [
  {
    rank: 1, company: 'MicroStrategy', ticker: 'MSTR', btcHoldings: 226000,
    basicMNAV: 1.8, dilutedMNAV: 2.1, price: 1200, oneDayChangePercent: 5.4,
    dilutedMNAVPrice: 570, enterpriseValueUSD: 4.2e10, avgVolumeUSD: 1e9,
    btcNAVUSD: 1.5e10, totalDebt: 2e9,
  },
  {
    rank: 2, company: 'Metaplanet', ticker: 'MTPLF', btcHoldings: 10000,
    basicMNAV: null, dilutedMNAV: null, price: null, oneDayChangePercent: -3.2,
    dilutedMNAVPrice: null, enterpriseValueUSD: null, avgVolumeUSD: null,
    btcNAVUSD: null, totalDebt: null,
  },
  {
    rank: 3, company: 'Semler', ticker: 'SMLR', btcHoldings: 1200,
    basicMNAV: 1.1, dilutedMNAV: 1.2, price: 40, oneDayChangePercent: 0,
    dilutedMNAVPrice: 35, enterpriseValueUSD: 5e8, avgVolumeUSD: 1e7,
    btcNAVUSD: 1.2e8, totalDebt: 0,
  },
  {
    rank: 4, company: 'Boyaa', ticker: 'BOYAA', btcHoldings: 3000,
    basicMNAV: 0.9, dilutedMNAV: 0.95, price: 5, oneDayChangePercent: 2.1,
    dilutedMNAVPrice: 4.5, enterpriseValueUSD: 3e8, avgVolumeUSD: 5e6,
    btcNAVUSD: 2.5e8, totalDebt: 0,
  },
  {
    rank: 5, company: 'NoChange', ticker: 'NOCH', btcHoldings: 100,
    basicMNAV: 1, dilutedMNAV: 1, price: 1, oneDayChangePercent: null,
    dilutedMNAVPrice: 1, enterpriseValueUSD: 1e6, avgVolumeUSD: 1e5,
    btcNAVUSD: 1e6, totalDebt: 0,
  },
];

const btctc: Btctc = { asOf: '2026-06-22T22:00:00.000Z', companies: btctcCompanies };

const onChain: OnChain = {
  asOf: '2026-06-22T22:00:00.000Z',
  metrics: {
    fearAndGreed: 55,
    mvrvZScore: 2.34,
    nupl: 0.55,
    fundingRate: 0.0001,
    movingAverage200w: 48000,
  },
};

const okDeps: ToolDeps = {
  getFundSummary: async () => summary,
  fetchPositions: async () => positions,
  fetchPositionByTicker: async () => positionFound,
  fetchBtctc: async () => btctc,
  fetchBtctcCompany: async () => btctcCompanies[0],
  fetchOnChain: async () => onChain,
};

describe('TOOLS definitions', () => {
  test('exposes the full v2 tool set (the two summary tools + the 5 now-live tools)', () => {
    const names = TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      'get_btctc_company',
      'get_btctc_movers',
      'get_fund_summary',
      'get_holdings',
      'get_onchain_metrics',
      'get_position_by_ticker',
      'get_top_holdings',
    ]);
  });

  test('each tool has a valid object input_schema and a description', () => {
    for (const t of TOOLS) {
      expect(t.input_schema.type).toBe('object');
      expect(typeof t.description).toBe('string');
      expect((t.description as string).length).toBeGreaterThan(20);
    }
  });

  test('ticker-keyed tools require a ticker; movers accepts an optional numeric limit', () => {
    const byName = (n: string) => TOOLS.find((t) => t.name === n)!;
    for (const n of ['get_position_by_ticker', 'get_btctc_company']) {
      const schema = byName(n).input_schema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema.properties).toHaveProperty('ticker');
      expect(schema.required).toContain('ticker');
    }
    const movers = byName('get_btctc_movers').input_schema as {
      properties?: Record<string, { type?: string }>;
      required?: string[];
    };
    expect(movers.properties?.limit?.type).toBe('number');
    expect(movers.required ?? []).not.toContain('limit');
  });

  test('the previously-deferred tools are now present and dispatchable', async () => {
    const names = TOOLS.map((t) => t.name);
    for (const live of [
      'get_position_by_ticker',
      'get_holdings',
      'get_btctc_company',
      'get_btctc_movers',
      'get_onchain_metrics',
    ]) {
      expect(names).toContain(live);
    }
  });
});

describe('dispatchTool', () => {
  test('get_fund_summary maps to the fund summary, stamps asOf + source, percents verbatim', async () => {
    const r = await dispatchTool('get_fund_summary', {}, okDeps);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('asOf: 2026-06-22T20:00:00.000Z');
    expect(r.content).toContain('210k terminal API');
    expect(r.content).toContain('Live AUM: $94,638,882');
    expect(r.content).toContain('Fund MTD: -4.20%');
    expect(r.content).toContain('BTC MTD: -12.54%');
    // Alpha computed from the verbatim percents (no re-scaling).
    expect(r.content).toContain('Alpha (Fund MTD - BTC MTD): +8.34%');
  });

  test('get_top_holdings maps to the holdings list with weight + 1d', async () => {
    const r = await dispatchTool('get_top_holdings', {}, okDeps);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('MicroStrategy (MSTR): +18.50% weight, -2.10% 1d');
    expect(r.content).toContain('asOf: 2026-06-22T20:00:00.000Z');
  });

  test('empty holdings degrade gracefully', async () => {
    const emptyDeps: ToolDeps = {
      ...okDeps,
      getFundSummary: async () => ({ ...summary, topHoldings: [] }),
    };
    const r = await dispatchTool('get_top_holdings', {}, emptyDeps);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('No top holdings available.');
  });

  test('holdings cite the EOD-brief asOf, not the morning asOf (provenance)', async () => {
    const provDeps: ToolDeps = {
      ...okDeps,
      getFundSummary: async () => ({
        ...summary,
        asOf: '2026-06-22T13:00:00.000Z', // morning brief
        briefAsOf: '2026-06-22T22:00:00.000Z', // EOD brief — holdings come from here
      }),
    };
    const holdings = await dispatchTool('get_top_holdings', {}, provDeps);
    expect(holdings.content).toContain('asOf: 2026-06-22T22:00:00.000Z');
    expect(holdings.content).not.toContain('asOf: 2026-06-22T13:00:00.000Z');

    // The fund summary headline surfaces BOTH timestamps so the 1d figures
    // aren't silently stamped with the morning time.
    const fund = await dispatchTool('get_fund_summary', {}, provDeps);
    expect(fund.content).toContain('asOf: 2026-06-22T13:00:00.000Z');
    expect(fund.content).toContain('1d change & holdings as of 2026-06-22T22:00:00.000Z');
  });

  test('unknown tool name degrades gracefully (is_error, no throw)', async () => {
    const r = await dispatchTool('get_nonexistent_thing', { ticker: 'MSTR' }, okDeps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('Unknown tool');
  });

  test('a failing backing fetch degrades gracefully (is_error, no throw)', async () => {
    const failDeps: ToolDeps = {
      ...okDeps,
      getFundSummary: async () => {
        throw new Error('terminal 503');
      },
    };
    const r = await dispatchTool('get_fund_summary', {}, failDeps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('temporarily unavailable');
    // The raw upstream error must NOT leak into the model-facing content (it can
    // carry internal endpoint paths / stack traces). It is logged server-side only.
    expect(r.content).not.toContain('terminal 503');
  });

  // -- PR2: the now-live terminal-backed tools ------------------------------

  test('get_holdings renders the FULL position list with weight + 1d', async () => {
    const r = await dispatchTool('get_holdings', {}, okDeps);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('asOf: 2026-06-22T22:00:00.000Z');
    expect(r.content).toContain('All holdings (2)');
    expect(r.content).toContain('MicroStrategy (MSTR): +18.50% weight, -2.10% 1d');
    expect(r.content).toContain('Metaplanet (MTPLF): +9.20% weight, +3.40% 1d');
  });

  test('get_position_by_ticker (attribution unconfigured) shows aggregate ownership ONLY', async () => {
    const r = await dispatchTool('get_position_by_ticker', { ticker: 'mstr' }, okDeps);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('Position in MicroStrategy (MSTR)');
    expect(r.content).toContain('Weight: +18.50%');
    expect(r.content).toContain('Value: $17,500,000');
    expect(r.content).toContain('Ownership: +1.23%');
    expect(r.content).toContain('Basic shares outstanding: 1,000,000');
    // Aggregate-only: no fabricated per-entity breakdown.
    expect(r.content).toContain('Per-entity attribution is not configured');
    expect(r.content).not.toContain('Per-entity breakdown:');
  });

  test('get_position_by_ticker (attribution configured) renders the per-entity breakdown', async () => {
    const cfgDeps: ToolDeps = {
      ...okDeps,
      fetchPositionByTicker: async () => ({
        ...(positionFound as Extract<PositionByTicker, { found: true }>),
        ownership: {
          ownershipPercent: 1.23,
          sharesHeld: 12345,
          basicShares: 1000000,
          attributionConfigured: true,
          perEntity: [
            { fundEntity: 'Master Fund', sharesHeld: 10000, ownershipPercent: 1.0 },
            { fundEntity: 'SPV A', sharesHeld: 2345, ownershipPercent: 0.23 },
          ],
        },
      }),
    };
    const r = await dispatchTool('get_position_by_ticker', { ticker: 'MSTR' }, cfgDeps);
    expect(r.content).toContain('Per-entity breakdown:');
    expect(r.content).toContain('Master Fund: 10,000 shares (+1.00%)');
    expect(r.content).toContain('SPV A: 2,345 shares (+0.23%)');
  });

  test('get_position_by_ticker renders a clean no-position message when found:false', async () => {
    const missDeps: ToolDeps = {
      ...okDeps,
      fetchPositionByTicker: async (ticker: string) => ({ found: false, ticker }),
    };
    const r = await dispatchTool('get_position_by_ticker', { ticker: 'zzzz' }, missDeps);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('no position in ZZZZ');
  });

  test('get_position_by_ticker without a ticker is an is_error', async () => {
    const r = await dispatchTool('get_position_by_ticker', {}, okDeps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('requires a "ticker"');
  });

  test('get_btctc_company renders null fields as n/a (not 0)', async () => {
    const nullDeps: ToolDeps = {
      ...okDeps,
      fetchBtctcCompany: async () => btctcCompanies[1], // Metaplanet — all-null numerics
    };
    const r = await dispatchTool('get_btctc_company', { ticker: 'MTPLF' }, nullDeps);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('BTCTC company: Metaplanet (MTPLF)');
    expect(r.content).toContain('Price: n/a');
    expect(r.content).toContain('Basic mNAV: n/a');
    expect(r.content).toContain('Total debt: n/a');
    // BTC holdings is present, so it must NOT be n/a.
    expect(r.content).toContain('BTC holdings: 10,000 BTC');
  });

  test('get_btctc_company renders a not-found message for an unknown ticker', async () => {
    const missDeps: ToolDeps = {
      ...okDeps,
      fetchBtctcCompany: async (ticker: string) => ({ found: false, ticker }),
    };
    const r = await dispatchTool('get_btctc_company', { ticker: 'zzzz' }, missDeps);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('No Bitcoin treasury company found for ticker ZZZZ');
  });

  test('get_btctc_movers sorts by 1d change into gainers/losers and excludes null/zero', async () => {
    const r = await dispatchTool('get_btctc_movers', { limit: 2 }, okDeps);
    expect(r.isError).toBe(false);
    // Top gainer is MSTR (+5.4), second BOYAA (+2.1); top loser MTPLF (-3.2).
    const gainersIdx = r.content.indexOf('gainers');
    const losersIdx = r.content.indexOf('losers');
    expect(gainersIdx).toBeGreaterThan(-1);
    expect(losersIdx).toBeGreaterThan(gainersIdx);
    expect(r.content).toContain('MicroStrategy (MSTR): +5.40% 1d');
    expect(r.content).toContain('Metaplanet (MTPLF): -3.20% 1d');
    // SMLR (0%) and NOCH (null) must be excluded entirely.
    expect(r.content).not.toContain('SMLR');
    expect(r.content).not.toContain('NOCH');
  });

  test('get_onchain_metrics renders all five indicators', async () => {
    const r = await dispatchTool('get_onchain_metrics', {}, okDeps);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('asOf: 2026-06-22T22:00:00.000Z');
    expect(r.content).toContain('Fear & Greed: 55');
    expect(r.content).toContain('MVRV Z-Score: 2.34');
    expect(r.content).toContain('NUPL: 0.55');
    expect(r.content).toContain('200w moving average: $48,000');
  });

  test('a failing terminal-backed tool degrades gracefully (is_error, no leak)', async () => {
    const failDeps: ToolDeps = {
      ...okDeps,
      fetchOnChain: async () => {
        throw new Error('on-chain 503 /internal/path');
      },
    };
    const r = await dispatchTool('get_onchain_metrics', {}, failDeps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('temporarily unavailable');
    expect(r.content).not.toContain('/internal/path');
  });
});

describe('computeBtctcMovers', () => {
  test('gainers are highest 1d first, losers lowest first, null/zero excluded', () => {
    const { gainers, losers } = computeBtctcMovers(btctcCompanies, 5);
    expect(gainers.map((m) => m.ticker)).toEqual(['MSTR', 'BOYAA', 'MTPLF']);
    expect(losers.map((m) => m.ticker)).toEqual(['MTPLF', 'BOYAA', 'MSTR']);
    // Zero (SMLR) and null (NOCH) movers are filtered out.
    expect(gainers.some((m) => m.ticker === 'SMLR')).toBe(false);
    expect(gainers.some((m) => m.ticker === 'NOCH')).toBe(false);
  });

  test('respects the limit', () => {
    const { gainers, losers } = computeBtctcMovers(btctcCompanies, 1);
    expect(gainers).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(gainers[0].ticker).toBe('MSTR');
    expect(losers[0].ticker).toBe('MTPLF');
  });
});

describe('toToolResult', () => {
  test('wraps a dispatch result into an Anthropic tool_result block', () => {
    const block = toToolResult('tu_123', { content: 'hi', isError: false });
    expect(block).toEqual({
      type: 'tool_result',
      tool_use_id: 'tu_123',
      content: 'hi',
      is_error: false,
    });
  });

  test('carries the error flag through', () => {
    const block = toToolResult('tu_9', { content: 'boom', isError: true });
    expect(block.is_error).toBe(true);
  });
});

describe('MAX_TOOL_ITERATIONS', () => {
  test('is a small positive cap bounding cost/latency', () => {
    expect(MAX_TOOL_ITERATIONS).toBeGreaterThan(0);
    expect(MAX_TOOL_ITERATIONS).toBeLessThanOrEqual(6);
  });
});
