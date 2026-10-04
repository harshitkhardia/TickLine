// QuantPrime data path helpers.

// QP ships `ts` as a NAIVE-UTC ISO string with no "Z" suffix
// (e.g. "2026-07-04T12:34:56.789000"). `new Date(ts)` would parse it as LOCAL
// time, shifting every bar by the host's offset. Append "Z" so JS reads it as UTC.
export function parseTs(ts: string | number): number {
  if (typeof ts === "number") return ts; // already ms epoch
  return ts.endsWith("Z") || ts.includes("+") ? Date.parse(ts) : Date.parse(ts + "Z");
}

// QP's /history and /ws/ticks take a broker TOKEN (int), not a symbol string.
// No resolver exists on the data path (see backend report). Static map for v1.
export const TOKENS: Record<string, number> = {
  NIFTY: 256265, // NIFTY 50 index — the only real/default token the mock serves
  // Add more as the instrument registry grows. Unknown symbols fall back to NIFTY.
};

export function resolveToken(symbol: string): number {
  return TOKENS[symbol] ?? TOKENS.NIFTY;
}
