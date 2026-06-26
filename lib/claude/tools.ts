// FundBot v2 tool definitions + dispatch.
//
// These are the tools Claude can call on demand during the Slack Q&A loop.
// HARD RULE: every tool here MUST be backed by a terminal endpoint that
// actually exists AND is reachable with the Bearer BRIEF_API_KEY auth that
// fund-bot already holds. As of 210k-Terminal PR #80 the terminal exposes
// API-key-accessible read endpoints for positions, BTCTC companies, and
// on-chain metrics — so the per-ticker / full-position-list / treasury-company
// / on-chain tools that were previously deferred are now live.

import type { Tool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { getFundSummary, asOfLabel, type FundSummary } from '../terminal/summary';
import {
  fetchPositions,
  fetchPositionByTicker,
  type Positions,
  type PositionByTicker,
} from '../terminal/positions';
import {
  fetchBtctc,
  fetchBtctcCompany,
  type Btctc,
  type BtctcCompany,
  type BtctcCompanyResult,
} from '../terminal/btctc';
import { fetchOnChain, type OnChain } from '../terminal/on-chain';
import { fmtUsd, fmtPct } from '../format';

// Cap on tool iterations in the agent loop — bounds cost and latency.
export const MAX_TOOL_ITERATIONS = 4;

/**
 * Terminal fetchers injected into the dispatcher. Defaults to the live clients;
 * tests pass mocks so no network is hit.
 */
export interface ToolDeps {
  getFundSummary: () => Promise<FundSummary>;
  fetchPositions: () => Promise<Positions>;
  fetchPositionByTicker: (ticker: string) => Promise<PositionByTicker>;
  fetchBtctc: () => Promise<Btctc>;
  fetchBtctcCompany: (ticker: string) => Promise<BtctcCompanyResult>;
  fetchOnChain: () => Promise<OnChain>;
}

/**
 * The live terminal-backed dependencies. Exported so callers can override a
 * single fetcher (e.g. a per-request memoized getFundSummary) while keeping the
 * live implementations for the rest. dispatchTool() uses this when no deps are
 * passed.
 */
export const defaultDeps: ToolDeps = {
  getFundSummary,
  fetchPositions,
  fetchPositionByTicker,
  fetchBtctc,
  fetchBtctcCompany,
  fetchOnChain,
};

// Default number of gainers/losers to return for get_btctc_movers.
const DEFAULT_MOVERS_LIMIT = 5;

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
  {
    name: 'get_holdings',
    description:
      "Get the fund's FULL list of BTC-equity holdings from the terminal " +
      '(not just the top few), each with its portfolio weight (%) and 1-day ' +
      'price change (%). Use this when the user wants the complete position ' +
      'list or asks about a holding that may not be in the top few. The result ' +
      'includes an "asOf" timestamp you must cite.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_position_by_ticker',
    description:
      "Look up the fund's position in a SINGLE issuer by ticker (e.g. MSTR): " +
      'portfolio weight (%), market value, share quantity, 1-day price change, ' +
      "and the fund's aggregate ownership of that issuer (ownership %, shares " +
      'held, basic shares outstanding). Use this for "what is our position in ' +
      'X" or "how much of X do we own". Returns a clear "no position" message ' +
      'if the fund does not hold the ticker. The result includes an "asOf" ' +
      'timestamp you must cite.',
    input_schema: {
      type: 'object',
      properties: { ticker: { type: 'string' } },
      required: ['ticker'],
    },
  },
  {
    name: 'get_btctc_company',
    description:
      'Look up market data for a single Bitcoin treasury company (BTCTC) by ' +
      'ticker: BTC holdings, basic/diluted mNAV, price, 1-day change, ' +
      'enterprise value, BTC NAV, total debt, and more. Use this for questions ' +
      'about a treasury company\'s metrics (e.g. "what is MSTR\'s mNAV"). This ' +
      'is market/universe data, distinct from the fund\'s own position. Returns ' +
      'a "not found" message for an unknown ticker.',
    input_schema: {
      type: 'object',
      properties: { ticker: { type: 'string' } },
      required: ['ticker'],
    },
  },
  {
    name: 'get_btctc_movers',
    description:
      "Get today's biggest gainers and losers across the Bitcoin treasury " +
      'company (BTCTC) universe, ranked by 1-day price change (%). Use this ' +
      'for "show me the BTCTC movers" or "which treasury companies moved most ' +
      'today". Optionally pass "limit" to control how many gainers/losers to ' +
      'return (default 5).',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
  },
  {
    name: 'get_onchain_metrics',
    description:
      'Get the latest Bitcoin on-chain / market indicators from the terminal: ' +
      'Fear & Greed index, MVRV Z-Score, NUPL, perpetual funding rate, and the ' +
      '200-week moving average. Use this for "what is the MVRV / NUPL / ' +
      'fear-and-greed right now". The result includes an "asOf" timestamp you ' +
      'must cite.',
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

// A plain integer/decimal formatter that renders "n/a" for null (BTCTC fields
// may be null and must not be shown as 0).
function fmtNum(n: number | null): string {
  if (n == null) return 'n/a';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Nullable USD that renders "n/a" (not "N/A") for the BTCTC/position renderers
// where the desired no-data token is lowercase.
function fmtUsdOrNa(n: number | null): string {
  if (n == null) return 'n/a';
  return fmtUsd(n);
}

function fmtPctOrNa(n: number | null): string {
  if (n == null) return 'n/a';
  return fmtPct(n);
}

function renderHoldings(p: Positions): string {
  if (!p.holdings || p.holdings.length === 0) {
    return `asOf: ${p.asOf}\nSource: 210k terminal API\nNo holdings available.`;
  }
  const lines = p.holdings.map(
    (h) =>
      `- ${h.name} (${h.ticker || 'N/A'}): ${fmtPct(h.weightPercent)} weight, ` +
      `${fmtPct(h.change1dPct)} 1d`
  );
  return [
    `asOf: ${p.asOf}`,
    `Source: 210k terminal API`,
    `All holdings (${p.holdings.length}):`,
    ...lines,
  ].join('\n');
}

function renderPositionByTicker(ticker: string, r: PositionByTicker): string {
  if (!r.found) {
    return [
      `Source: 210k terminal API`,
      `The fund has no position in ${r.ticker.toUpperCase()} (ticker not held or unknown).`,
    ].join('\n');
  }

  const lines: string[] = [
    `asOf: ${r.asOf}`,
    `Source: 210k terminal API`,
    `Position in ${r.name} (${r.ticker.toUpperCase()}):`,
    `- Weight: ${fmtPctOrNa(r.position.weightPercent)}`,
    `- Value: ${fmtUsdOrNa(r.position.valueUsd)}`,
    `- Quantity: ${fmtNum(r.position.quantity)} shares`,
    `- 1d change: ${fmtPctOrNa(r.position.change1dPct)}`,
  ];

  const o = r.ownership;
  lines.push(
    `Ownership of ${r.ticker.toUpperCase()} (aggregate across fund entities):`,
    `- Ownership: ${fmtPctOrNa(o.ownershipPercent)}`,
    `- Shares held: ${fmtNum(o.sharesHeld)}`,
    `- Basic shares outstanding: ${fmtNum(o.basicShares)}`
  );

  if (o.attributionConfigured && o.perEntity && o.perEntity.length > 0) {
    lines.push('Per-entity breakdown:');
    for (const e of o.perEntity) {
      lines.push(
        `  - ${e.fundEntity}: ${fmtNum(e.sharesHeld)} shares (${fmtPctOrNa(
          e.ownershipPercent
        )})`
      );
    }
  } else {
    // Attribution not configured upstream: show aggregate ONLY — never fabricate
    // a per-entity split that falsely attributes the whole stake to one filer.
    lines.push(
      'Per-entity attribution is not configured; only the aggregate ownership above is available.'
    );
  }

  return lines.join('\n');
}

function renderBtctcCompany(ticker: string, r: BtctcCompanyResult): string {
  if ('found' in r && r.found === false) {
    return [
      `Source: 210k terminal API`,
      `No Bitcoin treasury company found for ticker ${r.ticker.toUpperCase()}.`,
    ].join('\n');
  }
  const c = r as BtctcCompany;
  return [
    `Source: 210k terminal API`,
    `BTCTC company: ${c.company} (${c.ticker.toUpperCase()})`,
    `- Rank: ${fmtNum(c.rank)}`,
    `- BTC holdings: ${fmtNum(c.btcHoldings)} BTC`,
    `- Price: ${fmtUsdOrNa(c.price)}`,
    `- 1d change: ${fmtPctOrNa(c.oneDayChangePercent)}`,
    `- Basic mNAV: ${fmtNum(c.basicMNAV)}`,
    `- Diluted mNAV: ${fmtNum(c.dilutedMNAV)}`,
    `- 1x diluted mNAV price: ${fmtUsdOrNa(c.dilutedMNAVPrice)}`,
    `- Enterprise value: ${fmtUsdOrNa(c.enterpriseValueUSD)}`,
    `- Avg volume: ${fmtUsdOrNa(c.avgVolumeUSD)}`,
    `- BTC NAV: ${fmtUsdOrNa(c.btcNAVUSD)}`,
    `- Total debt: ${fmtUsdOrNa(c.totalDebt)}`,
  ].join('\n');
}

export interface BtctcMover {
  company: string;
  ticker: string;
  changePercent: number;
  price: number | null;
  mNAV: number | null;
}

/**
 * Sort the BTCTC universe by 1-day change into top gainers and losers.
 * Mirrors the legacy lib/sheets/btctc.ts getBTCTCMovers logic, repointed at the
 * terminal payload: companies with a null/zero 1-day change are excluded so the
 * extremes are real moves, gainers are the top `limit`, losers the bottom `limit`.
 */
export function computeBtctcMovers(
  companies: BtctcCompany[],
  limit: number = DEFAULT_MOVERS_LIMIT
): { gainers: BtctcMover[]; losers: BtctcMover[] } {
  const sorted = companies
    .filter((c) => c.oneDayChangePercent != null && c.oneDayChangePercent !== 0)
    .sort(
      (a, b) => (b.oneDayChangePercent as number) - (a.oneDayChangePercent as number)
    );

  const toMover = (c: BtctcCompany): BtctcMover => ({
    company: c.company,
    ticker: c.ticker,
    changePercent: c.oneDayChangePercent as number,
    price: c.price,
    mNAV: c.dilutedMNAV,
  });

  const gainers = sorted.slice(0, limit).map(toMover);
  const losers = sorted.slice(-limit).reverse().map(toMover);
  return { gainers, losers };
}

function renderBtctcMovers(b: Btctc, limit: number): string {
  const { gainers, losers } = computeBtctcMovers(b.companies ?? [], limit);
  if (gainers.length === 0 && losers.length === 0) {
    return `asOf: ${b.asOf}\nSource: 210k terminal API\nNo BTCTC movers available.`;
  }
  const moverLine = (m: BtctcMover) =>
    `- ${m.company} (${m.ticker.toUpperCase()}): ${fmtPct(m.changePercent)} 1d, ` +
    `price ${fmtUsdOrNa(m.price)}, diluted mNAV ${fmtNum(m.mNAV)}`;
  return [
    `asOf: ${b.asOf}`,
    `Source: 210k terminal API`,
    `Top ${gainers.length} gainers:`,
    ...gainers.map(moverLine),
    `Top ${losers.length} losers:`,
    ...losers.map(moverLine),
  ].join('\n');
}

function renderOnChain(o: OnChain): string {
  const m = o.metrics;
  return [
    `asOf: ${o.asOf}`,
    `Source: 210k terminal API`,
    `On-chain / market indicators:`,
    `- Fear & Greed: ${fmtNum(m.fearAndGreed)}`,
    `- MVRV Z-Score: ${fmtNum(m.mvrvZScore)}`,
    `- NUPL: ${fmtNum(m.nupl)}`,
    `- Funding rate: ${fmtNum(m.fundingRate)}`,
    `- 200w moving average: ${fmtUsdOrNa(m.movingAverage200w)}`,
  ].join('\n');
}

// Pull a string `ticker` off an unknown tool input, or null if absent.
function readTicker(input: unknown): string | null {
  if (input && typeof input === 'object' && 'ticker' in input) {
    const t = (input as { ticker?: unknown }).ticker;
    if (typeof t === 'string' && t.trim()) return t.trim();
  }
  return null;
}

// Pull a positive integer `limit` off an unknown tool input, or the default.
function readLimit(input: unknown): number {
  if (input && typeof input === 'object' && 'limit' in input) {
    const l = (input as { limit?: unknown }).limit;
    if (typeof l === 'number' && Number.isFinite(l) && l > 0) {
      return Math.floor(l);
    }
  }
  return DEFAULT_MOVERS_LIMIT;
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
  input: unknown,
  deps: ToolDeps = defaultDeps
): Promise<DispatchResult> {
  if (!TOOL_NAMES.has(name)) {
    return {
      content: `Unknown tool "${name}". No data returned.`,
      isError: true,
    };
  }

  try {
    switch (name) {
      case 'get_fund_summary':
        return {
          content: renderFundSummary(await deps.getFundSummary()),
          isError: false,
        };
      case 'get_top_holdings':
        return {
          content: renderTopHoldings(await deps.getFundSummary()),
          isError: false,
        };
      case 'get_holdings':
        return {
          content: renderHoldings(await deps.fetchPositions()),
          isError: false,
        };
      case 'get_position_by_ticker': {
        const ticker = readTicker(input);
        if (!ticker) {
          return {
            content: 'get_position_by_ticker requires a "ticker" string.',
            isError: true,
          };
        }
        return {
          content: renderPositionByTicker(
            ticker,
            await deps.fetchPositionByTicker(ticker)
          ),
          isError: false,
        };
      }
      case 'get_btctc_company': {
        const ticker = readTicker(input);
        if (!ticker) {
          return {
            content: 'get_btctc_company requires a "ticker" string.',
            isError: true,
          };
        }
        return {
          content: renderBtctcCompany(
            ticker,
            await deps.fetchBtctcCompany(ticker)
          ),
          isError: false,
        };
      }
      case 'get_btctc_movers':
        return {
          content: renderBtctcMovers(await deps.fetchBtctc(), readLimit(input)),
          isError: false,
        };
      case 'get_onchain_metrics':
        return {
          content: renderOnChain(await deps.fetchOnChain()),
          isError: false,
        };
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
