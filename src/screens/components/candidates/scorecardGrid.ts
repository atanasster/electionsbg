/** Column classes for the MP scorecard's variable metric grid.
 *
 *  Written out in full, per surviving-metric count, for two reasons. Tailwind scans source
 *  for COMPLETE class names, so a `sm:grid-cols-${n}` is never emitted and the grid silently
 *  collapses to one column at every width. And the phone-width count has to be stated too: a
 *  lone metric under a base `grid-cols-2` sits in a half-width card beside an empty cell,
 *  which is the ragged look the variable grid exists to remove.
 *
 *  Its own module rather than beside the tile: a constant or a helper exported from a
 *  component file breaks fast refresh, and this pair is shared with the tile's test.
 */
export const GRID_COLS = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
} as const satisfies Record<number, string>;

type MetricCount = keyof typeof GRID_COLS;

/** Clamped rather than indexed raw. A `Record<number, string>` would have type-checked
 *  `GRID_COLS[5]` as `string` while returning `undefined`, giving
 *  `className="grid gap-3 undefined"` — a valid one-column grid with no error, no warning
 *  and no failing test. That is the same silent collapse the doc comment above exists to
 *  prevent, reached by a different route, and `noUncheckedIndexedAccess` is not enabled in
 *  this project to catch it. */
export const gridCols = (n: number): string =>
  GRID_COLS[Math.min(Math.max(n, 1), 4) as MetricCount];
