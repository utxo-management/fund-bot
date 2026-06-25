// Conversational Q&A payload for FundBot, sourced from the terminal API —
// the SAME source of truth the daily morning/EOD reports use. This is the
// single place the Slack Q&A path reads fund data from (it no longer touches
// Google Sheets).
//
// It composes the two API-key-accessible terminal endpoints the reports
// already consume:
//   - /api/morning-brief  → AUM, fund MTD/YTD, net cash, BTC price, BTC MTD
//   - /api/brief          → fund/BTC 1d change, top holdings (weight + 1d)
// Both go through fetchBrief()/fetchMorningBrief(), which already enforce the
// assertPercentUnits guard against the 100× scaling regression. We re-assert
// here on the composed view so any caller of getFundSummary() is also covered.

import { assertPercentUnits } from './client';
import { fetchBrief, type BriefHolding } from './brief';
import { fetchMorningBrief } from './morning-brief';

export interface FundSummaryHolding {
  name: string;
  ticker: string;
  weightPercent: number | null;
  change1dPct: number | null;
}

export interface FundSummary {
  // ISO timestamp from the terminal — the provenance stamp answers cite.
  asOf: string;
  fund: {
    aumUsd: number | null;
    change1dPct: number | null;
    mtdPct: number | null;
    ytdPct: number | null;
    cashUsd: number | null;
    asOfDate: string | null;
  };
  btc: {
    priceUsd: number | null;
    change1dPct: number | null;
    mtdPct: number | null;
  };
  topHoldings: FundSummaryHolding[];
}

/**
 * Fetch the composed fund summary from the terminal API.
 *
 * Reuses the report clients (and their percent-units guard). Fetches both
 * briefs in parallel. The morning-brief is the canonical source for AUM and
 * the MTD/YTD/cash figures (it matches the dashboard); the EOD brief supplies
 * the 1d change fields and the top-holdings list.
 */
export async function getFundSummary(): Promise<FundSummary> {
  const [brief, morning] = await Promise.all([fetchBrief(), fetchMorningBrief()]);

  const topHoldings: FundSummaryHolding[] = (brief.topHoldings ?? []).map(
    (h: BriefHolding) => ({
      name: h.name,
      ticker: h.ticker,
      weightPercent: h.weightPercent,
      change1dPct: h.change1dPct,
    })
  );

  const summary: FundSummary = {
    // Prefer the morning-brief asOf (canonical AUM source); fall back to brief.
    asOf: morning.asOf ?? brief.asOf,
    fund: {
      aumUsd: morning.fund?.aumUsd ?? brief.fund?.aumUsd ?? null,
      change1dPct: brief.fund?.change1dPct ?? null,
      mtdPct: morning.fund?.mtdPct ?? null,
      ytdPct: morning.fund?.ytdPct ?? null,
      cashUsd: morning.fund?.cashUsd ?? null,
      asOfDate: brief.fund?.asOfDate ?? null,
    },
    btc: {
      priceUsd: morning.btc?.priceUsd ?? brief.btc?.priceUsd ?? null,
      change1dPct: brief.btc?.change1dPct ?? null,
      mtdPct: morning.btcMtdPct ?? null,
    },
    topHoldings,
  };

  // Re-assert the units contract on the composed view. fetchBrief/
  // fetchMorningBrief already check their own payloads, but composing them is
  // exactly the kind of seam where a future refactor could reintroduce drift.
  assertPercentUnits('FundSummary', [
    ['fund.change1dPct', summary.fund.change1dPct],
    ['fund.mtdPct', summary.fund.mtdPct],
    ['fund.ytdPct', summary.fund.ytdPct],
    ['btc.change1dPct', summary.btc.change1dPct],
    ['btc.mtdPct', summary.btc.mtdPct],
    ...summary.topHoldings.map(
      (h, i): [string, number | null | undefined] => [
        `topHoldings[${i}].change1dPct`,
        h.change1dPct,
      ]
    ),
  ]);

  return summary;
}
