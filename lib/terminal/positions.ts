// Typed client for the terminal /api/positions endpoints (FundBot v2).
// Backs the get_holdings and get_position_by_ticker tools. Both go through
// fetchTerminal() (Bearer BRIEF_API_KEY) and assert the percent-units contract.

import { fetchTerminal, assertPercentUnits } from './client';

export interface PositionHolding {
  name: string;
  ticker: string;
  weightPercent: number | null;
  change1dPct: number | null;
}

export interface Positions {
  asOf: string;
  holdings: PositionHolding[];
}

export interface PositionEntityShare {
  fundEntity: string;
  sharesHeld: number | null;
  ownershipPercent: number | null;
}

export interface PositionOwnership {
  ownershipPercent: number | null;
  sharesHeld: number | null;
  basicShares: number | null;
  attributionConfigured: boolean;
  // Only present when attribution is configured upstream; never fabricated here.
  perEntity?: PositionEntityShare[];
}

export interface PositionDetail {
  asOf: string;
  ticker: string;
  name: string;
  found: true;
  position: {
    weightPercent: number | null;
    valueUsd: number | null;
    quantity: number | null;
    change1dPct: number | null;
  };
  ownership: PositionOwnership;
}

export interface PositionNotFound {
  found: false;
  ticker: string;
}

export type PositionByTicker = PositionDetail | PositionNotFound;

export async function fetchPositions(): Promise<Positions> {
  const positions = await fetchTerminal<Positions>('/api/positions');

  // 1-day moves are short-window; the tight default bound trips the ×100 bug.
  assertPercentUnits('Positions', [
    ...(positions.holdings ?? []).map(
      (h, i): [string, number | null | undefined] => [
        `holdings[${i}].change1dPct`,
        h.change1dPct,
      ]
    ),
  ]);

  return positions;
}

export async function fetchPositionByTicker(
  ticker: string
): Promise<PositionByTicker> {
  const detail = await fetchTerminal<PositionByTicker>(
    `/api/positions/${encodeURIComponent(ticker)}`
  );

  if (detail.found) {
    // change1dPct is a 1-day move (tight bound); ownershipPercent is a fund
    // ownership stake that realistically can never exceed 100% — both use the
    // default ±100 bound to catch a ×100 scaling regression upstream.
    assertPercentUnits(`Position ${ticker}`, [
      ['position.change1dPct', detail.position?.change1dPct],
      ['ownership.ownershipPercent', detail.ownership?.ownershipPercent],
      ...(detail.ownership?.perEntity ?? []).map(
        (e, i): [string, number | null | undefined] => [
          `ownership.perEntity[${i}].ownershipPercent`,
          e.ownershipPercent,
        ]
      ),
    ]);
  }

  return detail;
}
