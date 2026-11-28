// The /sector/health hub and its sub-pages — the canonical paths, and NOTHING
// else. This file must stay import-free (the transportPaths.ts / eduPaths.ts
// rule): the hub registry, the governance sector list and the routes need a
// PATH, and an edge into the health register from routes.tsx would drag the
// sector-pack cluster into the entry chunk every page downloads.
// src/entryGraph.test.ts gates it.

/** The hub and its sub-pages, vaccines included. */
export const HEALTH_PATHS = {
  hub: "/sector/health",
  hospitals: "/sector/health/hospitals",
  drugs: "/sector/health/drugs",
  procurement: "/sector/health/procurement",
  money: "/sector/health/money",
  vaccines: "/sector/health/vaccines",
} as const;

/** `?universe=` values /procurement accepts (validated on read). Page-local:
 *  not in the usePreserveParams allowlist. Restated as literals so this file
 *  stays import-free; healthRegistry.test.ts holds them equal to
 *  HEALTH_UNIVERSES. */
export const HEALTH_UNIVERSE_PARAMS = ["nzok", "mz", "mz_bodies"] as const;
