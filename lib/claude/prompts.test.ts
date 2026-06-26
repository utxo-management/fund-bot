import { test, expect, describe } from 'bun:test';
import { buildSystemPrompt, buildQuickSystemPrompt, formatAsOf } from './prompts';
import type { FundSummary } from '../terminal/summary';

const baseSummary: FundSummary = {
  asOf: '2026-06-22T20:00:00.000Z',
  fund: {
    aumUsd: 94638882.15,
    change1dPct: -1.3,
    mtdPct: -4.2,
    ytdPct: -16.18,
    cashUsd: 4366855,
    asOfDate: '2026-06-22',
  },
  btc: {
    priceUsd: 64414.64,
    change1dPct: -0.85,
    mtdPct: -12.54,
  },
  topHoldings: [
    { name: 'MicroStrategy', ticker: 'MSTR', weightPercent: 18.5, change1dPct: -2.1 },
    { name: 'Metaplanet', ticker: 'MTPLF', weightPercent: 9.2, change1dPct: 3.4 },
  ],
};

describe('buildSystemPrompt', () => {
  test('stamps an as-of time and source provenance', () => {
    const p = buildSystemPrompt({ summary: baseSummary });
    // The formatted ET as-of must appear, and the prompt must instruct citing it.
    const asOfEt = formatAsOf(baseSummary.asOf);
    expect(p).toContain(asOfEt);
    expect(p).toContain('210k terminal');
    expect(p.toLowerCase()).toContain('as of');
    // Provenance instruction present
    expect(p).toContain('DATA SOURCE & PROVENANCE');
  });

  test('renders ×100 percents verbatim — regression for the 100× under-report', () => {
    const p = buildSystemPrompt({ summary: baseSummary });
    expect(p).toContain('Fund MTD: -4.20%');
    expect(p).toContain('Fund YTD: -16.18%');
    expect(p).toContain('BTC MTD: -12.54%');
    // Alpha is computed verbatim from the two MTD figures, not re-scaled.
    expect(p).toContain('Alpha (Fund MTD - BTC MTD): +8.34%');
    // It must instruct the model NOT to re-scale.
    expect(p.toLowerCase()).toContain('do not multiply');
  });

  test('renders dollar fields unscaled', () => {
    const p = buildSystemPrompt({ summary: baseSummary });
    expect(p).toContain('Live AUM: $94,638,882');
    expect(p).toContain('Net Cash: $4,366,855');
    expect(p).toContain('BTC Price: $64,415');
  });

  test('lists top holdings with weight and 1d change', () => {
    const p = buildSystemPrompt({ summary: baseSummary });
    expect(p).toContain('MicroStrategy (MSTR): +18.50% weight, -2.10% 1d');
    expect(p).toContain('Metaplanet (MTPLF): +9.20% weight, +3.40% 1d');
  });

  test('null figures degrade to N/A, not 0 or a crash', () => {
    const sparse: FundSummary = {
      asOf: '2026-06-22T20:00:00.000Z',
      fund: { aumUsd: null, change1dPct: null, mtdPct: null, ytdPct: null, cashUsd: null, asOfDate: null },
      btc: { priceUsd: null, change1dPct: null, mtdPct: null },
      topHoldings: [],
    };
    const p = buildSystemPrompt({ summary: sparse });
    expect(p).toContain('Live AUM: N/A');
    expect(p).toContain('Fund MTD: N/A');
    // No TOP HOLDINGS section when empty.
    expect(p).not.toContain('TOP HOLDINGS');
  });

  test('advertises the now-live tools (per-ticker / full holdings / btctc / on-chain)', () => {
    const p = buildSystemPrompt({ summary: baseSummary });
    expect(p).toContain('get_holdings');
    expect(p).toContain('get_position_by_ticker');
    expect(p).toContain('get_btctc_company');
    expect(p).toContain('get_btctc_movers');
    expect(p).toContain('get_onchain_metrics');
  });

  test('buildQuickSystemPrompt matches the full builder', () => {
    expect(buildQuickSystemPrompt(baseSummary)).toBe(buildSystemPrompt({ summary: baseSummary }));
  });
});

describe('formatAsOf', () => {
  test('falls back to the raw string for an unparseable input', () => {
    expect(formatAsOf('not-a-date')).toBe('not-a-date');
  });
});
