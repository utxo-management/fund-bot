// Typed client for the terminal /api/on-chain endpoint (FundBot v2).
// Backs the get_onchain_metrics tool. Goes through fetchTerminal()
// (Bearer BRIEF_API_KEY).
//
// NOTE on units: these are raw on-chain indicators, not percent moves —
// Fear & Greed is a 0-100 index, MVRV Z-Score / NUPL are unbounded ratios,
// funding rate is a tiny fraction, and the 200w MA is a USD price. None of them
// are ×100-scaled percents, so the assertPercentUnits guard does not apply here.

import { fetchTerminal } from './client';

export interface OnChainMetrics {
  fearAndGreed: number | null;
  mvrvZScore: number | null;
  nupl: number | null;
  fundingRate: number | null;
  movingAverage200w: number | null;
}

export interface OnChain {
  asOf: string;
  metrics: OnChainMetrics;
}

export async function fetchOnChain(): Promise<OnChain> {
  return fetchTerminal<OnChain>('/api/on-chain');
}
