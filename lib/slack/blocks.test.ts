import { test, expect, describe } from 'bun:test';
import { buildMorningReportBlocks, buildEodReportBlocks } from './blocks';
import type { MorningBrief } from '../terminal/morning-brief';
import type { Brief } from '../terminal/brief';

const sectionText = (blocks: unknown[], needle: string): string =>
  (blocks as Array<{ text?: { text?: string } }>)
    .map((b) => b.text?.text)
    .find((t): t is string => !!t && t.includes(needle)) ?? '';

describe('buildMorningReportBlocks — FUND BRIEF', () => {
  const brief: MorningBrief = {
    asOf: '2026-06-22T20:00:00.000Z',
    btc: { priceUsd: 64414.64 },
    fund: { aumUsd: 94638882.15, mtdPct: -4.2, ytdPct: -16.18, cashUsd: 4366855 },
    btcMtdPct: -12.54,
  };
  const fund = (b: MorningBrief = brief) => sectionText(buildMorningReportBlocks(b, null), 'FUND BRIEF');

  test('renders ×100 percents verbatim — regression for the 100× under-report', () => {
    const t = fund();
    expect(t).toContain('Fund MTD: -4.20%');
    expect(t).toContain('BTC MTD: -12.54%');
  });

  test('renders Fund YTD directly under Fund MTD', () => {
    const t = fund();
    expect(t).toContain('Fund YTD: -16.18%');
    expect(t.indexOf('Fund MTD')).toBeLessThan(t.indexOf('Fund YTD'));
    expect(t.indexOf('Fund YTD')).toBeLessThan(t.indexOf('BTC MTD'));
  });

  test('renders dollar fields unscaled', () => {
    const t = fund();
    expect(t).toContain('AUM: $94,638,882');
    expect(t).toContain('Cash: $4,366,855');
  });

  test('null percent degrades to N/A', () => {
    expect(fund({ ...brief, btcMtdPct: null })).toContain('BTC MTD: N/A');
  });
});

describe('buildEodReportBlocks — Top Holdings', () => {
  const base: Brief = {
    asOf: '2026-06-22T20:00:00.000Z',
    btc: { priceUsd: 64414, change1dPct: 1.86 },
    fund: { aumUsd: 96000000, change1dPct: -0.1, asOfDate: '2026-06-21' },
    topHoldings: [
      { name: 'Astra Enterprise Public Company Limited', ticker: 'ASTR', weightPercent: 28.78, change1dPct: -1.64 },
      { name: 'The Smarter Web Company PLC', ticker: 'SWC', weightPercent: 15.95, change1dPct: -4.88 },
      { name: 'Moon Inc', ticker: '1723', weightPercent: 15.15, change1dPct: 0 },
    ],
  };
  const holdings = (b: Brief = base) => sectionText(buildEodReportBlocks(b, null), '210K BRIEF');

  test('maps known tickers to short display names', () => {
    const t = holdings();
    expect(t).toContain('1. Astra  -1.64%');
    expect(t).toContain('2. Smarter Web  -4.88%');
  });

  test('falls back to the full legal name for unmapped tickers', () => {
    expect(holdings()).toContain('3. Moon Inc  +0.00%*');
  });

  test('zero-change gets the * marker and footnote', () => {
    const t = holdings();
    expect(t).toContain('+0.00%*');
    expect(t).toContain('upstream reports no movement');
  });

  test('null change renders LOUD, never a silent N/A — regression for the DV8 outage', () => {
    const withStale: Brief = {
      ...base,
      topHoldings: [
        { name: 'Dead Co Ltd', ticker: 'XYZ', weightPercent: 5, change1dPct: null },
        ...base.topHoldings,
      ],
    };
    const t = holdings(withStale);
    expect(t).toContain('1. Dead Co Ltd  no recent quote†');
    expect(t).toContain('no recent price quote');
    expect(t).not.toContain('N/A');
  });
});
