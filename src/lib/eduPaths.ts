// The /sector/edu hub and its sub-pages — the canonical paths, and NOTHING else.
// This file must stay import-free (the transportPaths.ts rule): the hub registry,
// the governance sector list and the routes need a PATH, and an edge into the
// education register from routes.tsx would drag the sector-pack cluster into the
// entry chunk every page downloads. src/entryGraph.test.ts gates it.

/** The hub and its three sub-pages. */
export const EDU_PATHS = {
  hub: "/sector/edu",
  procurement: "/sector/edu/procurement",
  bodies: "/sector/edu/bodies",
  money: "/sector/edu/money",
} as const;

/** `?universe=` values /procurement and /bodies accept (validated on read).
 *  Page-local: not in the usePreserveParams allowlist. Restated as literals so
 *  this file stays import-free; eduRegistry.test.ts holds them equal to
 *  EDU_UNIVERSES. */
export const EDU_UNIVERSE_PARAMS = [
  "ministry",
  "agency",
  "higher_education",
  "research_ban",
  "research_ssa",
] as const;
