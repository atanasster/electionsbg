// Pure grouping/spread logic for SectorPointMap — the part a refactor could
// silently break (co-location bucketing, busiest-first order, the spiderfy
// predicate + ring math). Kept out of the component file so it is unit-tested
// without a DOM and doesn't break the component's Fast Refresh (same rationale as
// routeBounds.ts).

import type { SectorMapPoint } from "./SectorPointMap";

// Value-coloured dot radius (dotMode) and the base pixel ring a group fans out onto.
export const DOT_RADIUS = 5;
export const SPREAD_RADIUS = 26;

// Bucket points sharing an exact loc into one group each, sorted busiest-first
// (highest `value` → group[0] colours the marker and is the pager's first page).
// Groups are then ordered so the busiest city draws last, i.e. on top.
export const groupByLoc = (points: SectorMapPoint[]): SectorMapPoint[][] => {
  const byLoc = new Map<string, SectorMapPoint[]>();
  for (const p of points) {
    const key = `${p.loc[0]},${p.loc[1]}`;
    (byLoc.get(key) ?? byLoc.set(key, []).get(key)!).push(p);
  }
  return [...byLoc.values()]
    .map((g) => g.slice().sort((a, b) => b.value - a.value))
    .sort((a, b) => a[0].value - b[0].value);
};

// Whether a co-located group spiderfies into individual dots at the current zoom:
// only when spreadZoom is configured and reached, and the group has more than one
// member but no more than spreadMax (huge stacks like София stay a pager badge).
export const shouldSpread = (args: {
  len: number;
  zoom: number | null;
  spreadZoom: number | undefined;
  spreadMax: number;
}): boolean =>
  args.spreadZoom != null &&
  args.zoom != null &&
  args.zoom >= args.spreadZoom &&
  args.len > 1 &&
  args.len <= args.spreadMax;

// Pixel radius of a group's spiderfy ring, grown with member count so dots keep
// roughly constant spacing instead of crowding near spreadMax.
export const spreadRadius = (n: number): number =>
  Math.max(SPREAD_RADIUS, (DOT_RADIUS * 2.4 * n) / (2 * Math.PI));
