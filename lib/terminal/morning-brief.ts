// Typed client for the terminal /api/morning-brief endpoint.
// Single source of truth for the morning report payload.

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
  const terminalApiUrl = process.env.TERMINAL_API_URL;
  const briefApiKey = process.env.BRIEF_API_KEY;

  if (!terminalApiUrl || !briefApiKey) {
    throw new Error('TERMINAL_API_URL and BRIEF_API_KEY must be set');
  }

  const res = await fetch(`${terminalApiUrl}/api/morning-brief`, {
    headers: { Authorization: `Bearer ${briefApiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Morning Brief API ${res.status}: ${await res.text()}`);
  }

  const brief = (await res.json()) as MorningBrief;

  // Units contract: every percent field is ×100-scaled (e.g. -4.2 for -4.2%),
  // matching /api/brief. fmtPct appends "%" WITHOUT scaling, so the API must do it.
  // This guard catches the double-multiply direction only: if the API and the
  // client both scale, -4.2 becomes -420. Realistic fund/BTC moves are well under
  // ±100%, so any |pct| > 100 means a scaling regression upstream — fail loudly
  // rather than post wildly wrong numbers to the fund channel.
  // (It cannot catch the opposite regression — raw ratios like -0.042 — because a
  // genuinely flat month is also near zero; that direction is owned by the API repo.)
  const pctFields: Array<[string, number | null | undefined]> = [
    ['fund.mtdPct', brief.fund?.mtdPct],
    ['fund.ytdPct', brief.fund?.ytdPct],
    ['btcMtdPct', brief.btcMtdPct],
  ];
  for (const [name, value] of pctFields) {
    if (value != null && Math.abs(value) > 100) {
      throw new Error(
        `Morning Brief units check failed: ${name}=${value} exceeds ±100%. ` +
        `Expected a ×100-scaled percent (e.g. -4.2); likely a double-multiply upstream.`
      );
    }
  }

  return brief;
}
