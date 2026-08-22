/**
 * The deferred locale bundles.
 *
 * The corpus is ONE flat i18next namespace that every page used to download in
 * full before it could paint — ~6.3k keys, and growing with every feature, so
 * the per-language brotli budgets in tests/perf.spec.ts were being tripped
 * every few days with no lever left but this one. A bundle is a slice of that
 * corpus whose keys are reachable ONLY from the routes that load it, split into
 * its own chunk and fetched alongside the route's own chunk.
 *
 * Adding one is three edits and a measurement:
 *   1. add the name here;
 *   2. tag its routes with `withBundle("<name>", …)` in src/routes.tsx;
 *   3. `npx tsx scripts/i18n/split_bundles.ts --apply` to move the keys that
 *      the reachability analysis proves are exclusive to those routes;
 *   4. re-ratchet the budgets in tests/perf.spec.ts to the new measurement.
 *
 * scripts/i18n/bundle_reachability.test.ts is what keeps step 3 true as the app
 * changes: a component that starts naming a bundled key from a route outside
 * the bundle fails there, in seconds, rather than rendering the raw key at a
 * 200 on a page nobody is watching.
 *
 * DELIBERATELY IMPORT-FREE. src/routes.tsx names these, and routes.tsx is a
 * static import of the entry chunk — see src/entryGraph.test.ts for the last
 * time a nav surface took one constant from a module that named a family.
 */
export const LOCALE_BUNDLES = ["budget", "methodology"] as const;

export type LocaleBundle = (typeof LOCALE_BUNDLES)[number];
