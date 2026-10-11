/** Compact token counts used by the Pencil conversation controls. */
export function formatCapacity(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(2))}M`;
  if (tokens >= 1_000) return `${Number((tokens / 1_000).toFixed(2))}K`;
  return String(tokens);
}
