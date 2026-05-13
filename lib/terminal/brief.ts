// Typed client for the terminal /api/brief endpoint.
// Single source of truth for the EOD report payload.

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
}

export async function fetchBrief(): Promise<Brief> {
  const terminalApiUrl = process.env.TERMINAL_API_URL;
  const briefApiKey = process.env.BRIEF_API_KEY;

  if (!terminalApiUrl || !briefApiKey) {
    throw new Error('TERMINAL_API_URL and BRIEF_API_KEY must be set');
  }

  const res = await fetch(`${terminalApiUrl}/api/brief`, {
    headers: { Authorization: `Bearer ${briefApiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Brief API ${res.status}: ${await res.text()}`);
  }

  return (await res.json()) as Brief;
}
