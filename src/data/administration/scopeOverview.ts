// Pure, UI-free helper for the /sector/administration screen. The population,
// GF01/cost and year-scoping derivations that used to live here were folded into
// scripts/administration/build_context.ts (the single source of the precomputed
// serving blob the screen reads), so only the divergence-callout %-change helper
// remains client-side. See docs/plans/administration-view-v1.md §6.

/** % change first→last of a numeric annual series (for the divergence callout). */
export const pctChange = (
  series: Array<{ year: number; value: number }>,
): { from: number; to: number; pct: number } | null => {
  if (series.length < 2) return null;
  const asc = [...series].sort((a, b) => a.year - b.year);
  const first = asc[0];
  const last = asc[asc.length - 1];
  if (!first.value) return null;
  return {
    from: first.year,
    to: last.year,
    pct: (last.value - first.value) / first.value,
  };
};
