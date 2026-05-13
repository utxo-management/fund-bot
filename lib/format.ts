// Nullable-aware formatters for brief payloads.
// Differs from lib/utils/formatting.ts: those assume non-null and use emojis;
// these render "N/A" for null and produce plain "$1,234" / "+5.53%" strings.

export function fmtUsd(n: number | null): string {
  if (n == null) return 'N/A';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function fmtPct(n: number | null): string {
  if (n == null) return 'N/A';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}
