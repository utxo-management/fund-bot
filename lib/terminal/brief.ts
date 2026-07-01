// Typed client for the terminal /api/brief endpoint.
// Single source of truth for the EOD report payload.

import { fetchTerminal, assertPercentUnits, CUMULATIVE_MAX_ABS_PCT } from './client';

export interface BriefHolding {
  name: string;
  ticker: string;
  weightPercent: number | null;
  change1dPct: number | null;
}

export interface Brief {
  asOf: string;
  btc: {
    priceUsd: number | null;
    change1dPct: number | null;
  };
  fund: {
    aumUsd: number | null;
    change1dPct: number | null;
    asOfDate: string | null;
  };
  topHoldings: BriefHolding[];
  btcYtdPct: number | null;
}

export async function fetchBrief(): Promise<Brief> {
  const brief = await fetchTerminal<Brief>('/api/brief');

  assertPercentUnits('Brief', [
    ['btc.change1dPct', brief.btc?.change1dPct],
    ['fund.change1dPct', brief.fund?.change1dPct],
    // Cumulative YTD can legitimately run triple-digit — use the wider bound.
    ['btcYtdPct', brief.btcYtdPct, CUMULATIVE_MAX_ABS_PCT],
    ...(brief.topHoldings ?? []).map(
      (h, i): [string, number | null | undefined] => [`topHoldings[${i}].change1dPct`, h.change1dPct]
    ),
  ]);

  return brief;
}
