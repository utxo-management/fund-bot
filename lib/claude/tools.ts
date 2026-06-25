// FundBot v2 tool definitions + dispatch.
//
// These are the tools Claude can call on demand during the Slack Q&A loop.
// HARD RULE: every tool here MUST be backed by a terminal endpoint that
// actually exists AND is reachable with the Bearer BRIEF_API_KEY auth that
// fund-bot already holds. As of this change only /api/brief and
// /api/morning-brief are API-key-accessible (every positions/holdings/
// company/on-chain route on the terminal is Clerk-session-only). So the only
// tools we can back today both read from the composed getFundSummary().
//
// Deferred tools (do NOT add until the terminal exposes API-key endpoints —
// see PR "Deferred" section; blocked on 210k-Terminal #73's entity data):
//   - get_position_by_ticker / get_holdings (full position list)
//   - get_btctc_company / get_btctc_movers
//   - get_onchain_metrics
// TODO(v2.1): needs terminal API-key endpoints for positions / btctc /
// on-chain (post-#73). Until then these questions are answered "not available"
// by the prompt, and the help text does not promise them.

import type { Tool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { getFundSummary, asOfLabel, type FundSummary } from '../terminal/summary';
import { fmtUsd, fmtPct } from '../format';

// Cap on tool iterations in the agent loop — bounds cost and latency.
export const MAX_TOOL_ITERATIONS = 4;

/**
 * A terminal fetcher injected into the dispatcher. Defaults to the live
 * getFundSummary(); tests pass a mock so no network is hit.
 */
export interface ToolDeps {
  getFundSummary: () => Promise<FundSummary>;
}

const defaultDeps: ToolDeps = { getFundSummary };

// ---------------------------------------------------------------------------
// Tool definitions (Anthropic tool-use schema)
// ---------------------------------------------------------------------------

export const TOOLS: Tool[] = [
  {
    name: 'get_fund_summary',
    description:
      "Get the fund's current headline figures from the terminal (the same " +
      'source as the daily morning/EOD reports): live AUM, fund 1-day / ' +
      'month-to-date / year-to-date return, net cash, the current BTC price, ' +
      "BTC's 1-day change, and BTC month-to-date return. Use this for any " +
      'question about overall fund performance, AUM, cash, or Bitcoin price/ ' +
      'returns. The result includes an "asOf" timestamp you must cite.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_top_holdings',
    description:
      "Get the fund's largest BTC-equity holdings from the terminal, each " +
      'with its portfolio weight (%) and 1-day price change (%). Use this for ' +
      'questions about top positions, what the fund holds, position weights, ' +
      'or which holdings moved today. NOTE: only the top holdings are ' +
      'available via this source — it cannot look up an arbitrary ticker, the ' +
      'full position list, treasury-company (BTCTC) data, or on-chain metrics. ' +
      'The result includes an "asOf" timestamp you must cite.',
    input_schema: { type: 'object', properties: {} },
  },
];

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function renderFundSummary(s: FundSummary): string {
  const alpha =
    s.fund.mtdPct != null && s.btc.mtdPct != null
      ? fmtPct(s.fund.mtdPct - s.btc.mtdPct)
      : 'N/A';
  return [
    // asOfLabel surfaces the EOD-brief timestamp for the 1d fields when it differs
    // from the morning asOf, so the model cites the right freshness.
    `asOf: ${asOfLabel(s)}`,
    `Source: 210k terminal API`,
    `Live AUM: ${fmtUsd(s.fund.aumUsd)}`,
    `Fund 1d: ${fmtPct(s.fund.change1dPct)}`,
    `Fund MTD: ${fmtPct(s.fund.mtdPct)}`,
    `Fund YTD: ${fmtPct(s.fund.ytdPct)}`,
    `Net Cash: ${fmtUsd(s.fund.cashUsd)}`,
    `BTC Price: ${fmtUsd(s.btc.priceUsd)}`,
    `BTC 1d: ${fmtPct(s.btc.change1dPct)}`,
    `BTC MTD: ${fmtPct(s.btc.mtdPct)}`,
    `Alpha (Fund MTD - BTC MTD): ${alpha}`,
  ].join('\n');
}

function renderTopHoldings(s: FundSummary): string {
  // Holdings + their 1d moves come from the EOD brief, so cite that timestamp.
  const asOf = s.briefAsOf ?? s.asOf;
  if (!s.topHoldings || s.topHoldings.length === 0) {
    return `asOf: ${asOf}\nSource: 210k terminal API\nNo top holdings available.`;
  }
  const lines = s.topHoldings.map(
    (h) =>
      `- ${h.name} (${h.ticker || 'N/A'}): ${fmtPct(h.weightPercent)} weight, ` +
      `${fmtPct(h.change1dPct)} 1d`
  );
  return [`asOf: ${asOf}`, `Source: 210k terminal API`, 'Top holdings:', ...lines].join(
    '\n'
  );
}

export interface DispatchResult {
  content: string;
  isError: boolean;
}

/**
 * Execute one tool call by name. Never throws for a known tool whose backing
 * fetch fails — it returns an is_error tool_result so Claude can degrade
 * gracefully and still answer with what it has. Throws only for an unknown
 * tool name (a programming error, not a runtime data condition).
 */
export async function dispatchTool(
  name: string,
  _input: unknown,
  deps: ToolDeps = defaultDeps
): Promise<DispatchResult> {
  if (!TOOL_NAMES.has(name)) {
    return {
      content: `Unknown tool "${name}". No data returned.`,
      isError: true,
    };
  }

  try {
    const summary = await deps.getFundSummary();
    switch (name) {
      case 'get_fund_summary':
        return { content: renderFundSummary(summary), isError: false };
      case 'get_top_holdings':
        return { content: renderTopHoldings(summary), isError: false };
      default:
        return { content: `Unknown tool "${name}".`, isError: true };
    }
  } catch (err) {
    // Log the full error server-side, but do NOT surface the raw upstream message
    // to the model (and thence to Slack) — a terminal error body can contain
    // internal endpoint paths / stack traces. Claude gets a generic note only.
    console.error(`[Tool] ${name} backing fetch failed:`, err);
    return {
      content: `The "${name}" data source is temporarily unavailable. Answer with whatever you already have and tell the user this figure could not be fetched.`,
      isError: true,
    };
  }
}

/** Build a tool_result content block for the messages array. */
export function toToolResult(
  toolUseId: string,
  result: DispatchResult
): ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: result.content,
    is_error: result.isError,
  };
}
