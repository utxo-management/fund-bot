// Shared transport + units contract for the terminal API (terminal.utxomanagement.com).
// Both /api/brief (EOD) and /api/morning-brief go through here on purpose: the
// divergence between two near-identical clients is what produced the June 2026
// 100× scaling bug. One transport, one guard, no drift.

export async function fetchTerminal<T>(path: string): Promise<T> {
  const terminalApiUrl = process.env.TERMINAL_API_URL;
  const briefApiKey = process.env.BRIEF_API_KEY;

  if (!terminalApiUrl || !briefApiKey) {
    throw new Error('TERMINAL_API_URL and BRIEF_API_KEY must be set');
  }

  const res = await fetch(`${terminalApiUrl}${path}`, {
    headers: { Authorization: `Bearer ${briefApiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Terminal API ${path} ${res.status}: ${await res.text()}`);
  }

  return (await res.json()) as T;
}

// Units contract: the terminal API returns every percent field ×100-scaled
// (e.g. -4.2 for -4.2%). fmtPct appends "%" WITHOUT scaling, so the API must do it.
// This catches the double-multiply direction only: if the API and the client both
// scale, -4.2 becomes -420. Realistic fund/BTC/holding moves are well under ±100%,
// so any |pct| > 100 signals a scaling regression upstream — fail loudly rather than
// post wildly wrong numbers. (It cannot catch the opposite regression — raw ratios
// like -0.042 — because a genuinely flat period is also near zero; that's the API's job.)
export function assertPercentUnits(
  context: string,
  fields: Array<[string, number | null | undefined]>
): void {
  for (const [name, value] of fields) {
    if (value != null && Math.abs(value) > 100) {
      throw new Error(
        `${context} units check failed: ${name}=${value} exceeds ±100%. ` +
        `Expected a ×100-scaled percent (e.g. -4.2); likely a double-multiply upstream.`
      );
    }
  }
}
