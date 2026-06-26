// Typed client for the terminal /api/btctc endpoints (FundBot v2).
// Backs the get_btctc_company and get_btctc_movers tools. Both go through
// fetchTerminal() (Bearer BRIEF_API_KEY) and assert the percent-units contract.

import { fetchTerminal, assertPercentUnits } from './client';

// The BTCTC company shape the terminal emits. Every numeric field is nullable:
// thinly-covered values (mNAV, 1×-diluted-mNAV price, …) are preserved as null
// rather than coerced to 0, so renderers must handle null. This intentionally
// differs from the legacy non-null types/btctc.ts (sheet-sourced) shape.
export interface BtctcCompany {
  rank: number | null;
  company: string;
  ticker: string;
  btcHoldings: number | null;
  basicMNAV: number | null;
  dilutedMNAV: number | null;
  price: number | null;
  oneDayChangePercent: number | null;
  dilutedMNAVPrice: number | null;
  enterpriseValueUSD: number | null;
  avgVolumeUSD: number | null;
  btcNAVUSD: number | null;
  totalDebt: number | null;
}

export interface Btctc {
  asOf: string;
  companies: BtctcCompany[];
}

export interface BtctcNotFound {
  found: false;
  ticker: string;
}

export type BtctcCompanyResult = BtctcCompany | BtctcNotFound;

function isNotFound(r: BtctcCompanyResult): r is BtctcNotFound {
  return (r as BtctcNotFound).found === false;
}

export async function fetchBtctc(): Promise<Btctc> {
  const btctc = await fetchTerminal<Btctc>('/api/btctc');

  // oneDayChangePercent is a 1-day move (tight ±100 bound).
  assertPercentUnits('BTCTC', [
    ...(btctc.companies ?? []).map(
      (c, i): [string, number | null | undefined] => [
        `companies[${i}].oneDayChangePercent`,
        c.oneDayChangePercent,
      ]
    ),
  ]);

  return btctc;
}

export async function fetchBtctcCompany(
  ticker: string
): Promise<BtctcCompanyResult> {
  const result = await fetchTerminal<BtctcCompanyResult>(
    `/api/btctc/${encodeURIComponent(ticker)}`
  );

  if (!isNotFound(result)) {
    assertPercentUnits(`BTCTC ${ticker}`, [
      ['oneDayChangePercent', result.oneDayChangePercent],
    ]);
  }

  return result;
}
