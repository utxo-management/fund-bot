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
//
// The two endpoints fail independently: a single-endpoint outage degrades to a
// partial summary (the available endpoint's fields, the other side nulled) rather
// than failing the whole Q&A. Only when BOTH are down do we throw.

import { assertPercentUnits, CUMULATIVE_MAX_ABS_PCT } from './client';
import { fetchBrief, type BriefHolding } from './brief';
import { fetchMorningBrief } from './morning-brief';

export interface FundSummaryHolding {
  name: string;
  ticker: string;
  weightPercent: number | null;
  change1dPct: number | null;
}

export interface FundSummary {
  // Primary ISO timestamp (the morning brief — canonical AUM/MTD/YTD source).
  asOf: string;
  // ISO timestamp of the EOD /api/brief, which is the actual source of the 1d-change
  // fields and topHoldings. It's generated at a different time than the morning brief,
  // so answers about "today's moves" / holdings should cite this, not `asOf`. Null when
  // the EOD brief was unavailable (partial degradation).
  briefAsOf?: string | null;
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
 * A human-readable provenance label for the composed summary.
 *
 * The AUM/MTD/YTD figures carry the (morning) `asOf`; the 1d-change fields and
 * holdings come from the EOD brief and carry `briefAsOf`. When the two differ,
 * surface both so a "which holdings moved today?" answer doesn't cite the morning
 * timestamp for EOD-sourced data. Callers may format the timestamps for display.
 */
export function asOfLabel(s: Pick<FundSummary, 'asOf' | 'briefAsOf'>): string {
  if (s.briefAsOf && s.briefAsOf !== s.asOf) {
    return `${s.asOf} (1d change & holdings as of ${s.briefAsOf})`;
  }
  return s.asOf;
}

/**
 * Fetch the composed fund summary from the terminal API.
 *
 * Reuses the report clients (and their percent-units guard). Fetches both briefs
 * concurrently with Promise.allSettled so a single-endpoint outage degrades to a
 * partial summary instead of failing the whole request: the morning-brief is the
 * canonical source for AUM/MTD/YTD/cash, the EOD brief supplies the 1d-change
 * fields and the top-holdings list, and whichever side is down is simply nulled.
 * Only when BOTH endpoints fail do we throw (surfacing both reasons).
 */
export async function getFundSummary(): Promise<FundSummary> {
  const [briefRes, morningRes] = await Promise.allSettled([
    fetchBrief(),
    fetchMorningBrief(),
  ]);

  const brief = briefRes.status === 'fulfilled' ? briefRes.value : null;
  const morning = morningRes.status === 'fulfilled' ? morningRes.value : null;

  if (!brief && !morning) {
    const reasons = [briefRes, morningRes]
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
    throw new Error(`Terminal API unavailable: ${reasons.join('; ')}`);
  }
  if (!brief) {
    console.warn('[Terminal] /api/brief unavailable — 1d change + holdings omitted');
  }
  if (!morning) {
    console.warn('[Terminal] /api/morning-brief unavailable — AUM/MTD/YTD/cash omitted');
  }

  const topHoldings: FundSummaryHolding[] = (brief?.topHoldings ?? []).map(
    (h: BriefHolding) => ({
      name: h.name,
      ticker: h.ticker,
      weightPercent: h.weightPercent,
      change1dPct: h.change1dPct,
    })
  );

  const summary: FundSummary = {
    // Prefer the morning-brief asOf (canonical AUM source); fall back to brief.
    asOf: morning?.asOf ?? brief?.asOf ?? '',
    briefAsOf: brief?.asOf ?? null,
    fund: {
      aumUsd: morning?.fund?.aumUsd ?? brief?.fund?.aumUsd ?? null,
      change1dPct: brief?.fund?.change1dPct ?? null,
      mtdPct: morning?.fund?.mtdPct ?? null,
      ytdPct: morning?.fund?.ytdPct ?? null,
      cashUsd: morning?.fund?.cashUsd ?? null,
      asOfDate: brief?.fund?.asOfDate ?? null,
    },
    btc: {
      priceUsd: morning?.btc?.priceUsd ?? brief?.btc?.priceUsd ?? null,
      change1dPct: brief?.btc?.change1dPct ?? null,
      mtdPct: morning?.btcMtdPct ?? null,
    },
    topHoldings,
  };

  // Re-assert the units contract on the composed view. fetchBrief/
  // fetchMorningBrief already check their own payloads, but composing them is
  // exactly the kind of seam where a future refactor could reintroduce drift.
  // Cumulative returns (MTD/YTD) use the wider bound so a real triple-digit return
  // doesn't crash the bot; the tight bound stays on the 1-day fields.
  const checks: Array<[string, number | null | undefined, number?]> = [
    ['fund.change1dPct', summary.fund.change1dPct],
    ['fund.mtdPct', summary.fund.mtdPct, CUMULATIVE_MAX_ABS_PCT],
    ['fund.ytdPct', summary.fund.ytdPct, CUMULATIVE_MAX_ABS_PCT],
    ['btc.change1dPct', summary.btc.change1dPct],
    ['btc.mtdPct', summary.btc.mtdPct, CUMULATIVE_MAX_ABS_PCT],
    ...summary.topHoldings.map(
      (h, i): [string, number | null | undefined] => [
        `topHoldings[${i}].change1dPct`,
        h.change1dPct,
      ]
    ),
  ];
  assertPercentUnits('FundSummary', checks);

  return summary;
}
