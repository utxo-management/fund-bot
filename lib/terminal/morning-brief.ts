// Typed client for the terminal /api/morning-brief endpoint.
// Single source of truth for the morning report payload.

import { fetchTerminal, assertPercentUnits } from './client';

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

  assertPercentUnits('Morning Brief', [
    ['fund.mtdPct', brief.fund?.mtdPct],
    ['fund.ytdPct', brief.fund?.ytdPct],
    ['btcMtdPct', brief.btcMtdPct],
  ]);

  return brief;
}
