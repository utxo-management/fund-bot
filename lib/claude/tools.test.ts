import { test, expect, describe } from 'bun:test';
import {
  TOOLS,
  MAX_TOOL_ITERATIONS,
  dispatchTool,
  toToolResult,
  type ToolDeps,
} from './tools';
import type { FundSummary } from '../terminal/summary';

const summary: FundSummary = {
  asOf: '2026-06-22T20:00:00.000Z',
  fund: { aumUsd: 94638882, change1dPct: -1.3, mtdPct: -4.2, ytdPct: -16.18, cashUsd: 4366855, asOfDate: '2026-06-22' },
  btc: { priceUsd: 64414.64, change1dPct: -0.85, mtdPct: -12.54 },
  topHoldings: [
    { name: 'MicroStrategy', ticker: 'MSTR', weightPercent: 18.5, change1dPct: -2.1 },
  ],
};

const okDeps: ToolDeps = { getFundSummary: async () => summary };

describe('TOOLS definitions', () => {
  test('every tool is backed (only the two API-key-accessible terminal endpoints)', () => {
    const names = TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(['get_fund_summary', 'get_top_holdings']);
  });

  test('each tool has a valid object input_schema and a description', () => {
    for (const t of TOOLS) {
      expect(t.input_schema.type).toBe('object');
      expect(typeof t.description).toBe('string');
      expect((t.description as string).length).toBeGreaterThan(20);
    }
  });

  test('does NOT expose deferred (unbacked) tools', () => {
    const names = TOOLS.map((t) => t.name);
    for (const deferred of [
      'get_position_by_ticker',
      'get_holdings',
      'get_btctc_company',
      'get_btctc_movers',
      'get_onchain_metrics',
    ]) {
      expect(names).not.toContain(deferred);
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
      getFundSummary: async () => ({ ...summary, topHoldings: [] }),
    };
    const r = await dispatchTool('get_top_holdings', {}, emptyDeps);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('No top holdings available.');
  });

  test('unknown tool name degrades gracefully (is_error, no throw)', async () => {
    const r = await dispatchTool('get_onchain_metrics', { ticker: 'MSTR' }, okDeps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('Unknown tool');
  });

  test('a failing backing fetch degrades gracefully (is_error, no throw)', async () => {
    const failDeps: ToolDeps = {
      getFundSummary: async () => {
        throw new Error('terminal 503');
      },
    };
    const r = await dispatchTool('get_fund_summary', {}, failDeps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('temporarily unavailable');
    expect(r.content).toContain('terminal 503');
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
