// Number formatting shared by the ИСУН drill-down tiles and the screens that
// host them. Its own module so summaryTiles.tsx exports only components — the
// react-refresh rule, and a real constraint: a mixed module loses fast refresh.

export const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

export const numFmt = new Intl.NumberFormat("bg-BG");
