// Fires when the set of procurement SCOPE WINDOWS changes — i.e. on the Jan-1
// calendar rollover or when a new election lands in elections.json.
//
// WHY. `procurement_scopes` (migration 118) enumerates its year windows as
// SCOPE_FIRST_YEAR..currentYear and its parliament windows from elections.json. The
// per-scope precomputes (119/122/123/124) behind /procurement/by-settlement,
// /procurement/contractors and the six dashboard routes are built from that set. On
// 1 January a new `?pscope=y:<new year>` option appears in the UI while the tables
// still stop at the old year — that scope then serves an EMPTY page until someone
// re-runs db:load:procurement-scopes:pg:cloud. Nothing detected that rollover; this
// source does (cloud-deploy-speed-v1 §v2-g / the A3 gap).
//
// No network: the window set is a pure function of the current year and the committed
// elections.json, so the fingerprint is computed locally.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { SCOPE_FIRST_YEAR } from "../../../src/data/scope/constants";
import { allScopeWindows } from "../../../src/data/scope/windows";

const ELECTIONS_JSON = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../src/data/json/elections.json",
);

/** The election window names (YYYY_MM_DD), from the committed elections.json. */
const electionNames = (): string[] =>
  (
    JSON.parse(fs.readFileSync(ELECTIONS_JSON, "utf8")) as Array<{
      name: string;
    }>
  ).map((e) => e.name);

/**
 * Pure fingerprint of the scope-window set. Derived from `allScopeWindows` — the SAME
 * producer the loader (load_procurement_scopes_pg via scopedMatviews) builds its rows
 * from — so the watcher's identity of "the windows that must exist" cannot drift from
 * the loader's. The fingerprint is the ordered list of window KEYS (`all`, `y:<year>`,
 * `ns:<name>`); those are unique, so the joined string is collision-safe.
 *
 * Extracted so the rollover behaviour is testable without waiting for a real Jan 1.
 */
export const scopeWindowFingerprint = (
  currentYear: number,
  electionNames: readonly string[],
): Fingerprint => {
  const windows = allScopeWindows(
    electionNames.map((name) => ({ name })),
    currentYear,
  );
  const keys = windows.map((w) => w.key);
  const yearCount = keys.filter((k) => k.startsWith("y:")).length;
  const electionCount = keys.filter((k) => k.startsWith("ns:")).length;
  return {
    value: keys.join(","),
    detail: `${yearCount} year window(s) ${SCOPE_FIRST_YEAR}..${currentYear} + ${electionCount} election window(s) (+ all)`,
    meta: {
      currentYear,
      firstYear: SCOPE_FIRST_YEAR,
      yearCount,
      electionCount,
      windowCount: keys.length,
    },
  };
};

export const procurementScopeWindows: WatchSource = {
  id: "procurement_scope_windows",
  label: "Procurement scope windows (calendar / election rollover)",
  url: "docs/plans/cloud-deploy-speed-v1.md#v2-g",
  cadence: "daily", // probe daily so the Jan-1 rollover surfaces the same day
  publishes: "annual", // the deterministic trigger is the new calendar year
  fingerprint(): Promise<Fingerprint> {
    return Promise.resolve(
      scopeWindowFingerprint(new Date().getFullYear(), electionNames()),
    );
  },
  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return `${curr.detail} (baseline)`;
    return (
      `${curr.detail} — a new year or election window appeared; run ` +
      `\`npm run db:load:procurement-scopes:pg:cloud\` (46 s local, minutes on cloud) ` +
      `so /procurement/by-settlement, /procurement/contractors and the six dashboard ` +
      `routes serve the new scope instead of an empty page`
    );
  },
};
