// Typed client for the terminal /api/morning-brief endpoint.
// Single source of truth for the morning report payload.

import { fetchTerminal, assertPercentUnits, CUMULATIVE_MAX_ABS_PCT } from './client';

export interface MorningBrief {
  asOf: string;
  btc: {
    priceUsd: number | null;
  };
  fund: {
    aumUsd: number | null;
    mtdPct: number | null;
    ytdPct: number | null;
    cashUsd: number | null;
  };
  btcMtdPct: number | null;
}

export async function fetchMorningBrief(): Promise<MorningBrief> {
  const brief = await fetchTerminal<MorningBrief>('/api/morning-brief');

  // These are cumulative returns (MTD / YTD) that can legitimately run triple-digit
  // for a leveraged BTC-treasury book in a bull run, so they use the wider bound.
  // The tight ±100 tripwire still lives on the EOD brief's 1-day fields.
  assertPercentUnits('Morning Brief', [
    ['fund.mtdPct', brief.fund?.mtdPct, CUMULATIVE_MAX_ABS_PCT],
    ['fund.ytdPct', brief.fund?.ytdPct, CUMULATIVE_MAX_ABS_PCT],
    ['btcMtdPct', brief.btcMtdPct, CUMULATIVE_MAX_ABS_PCT],
  ]);

  return brief;
}
