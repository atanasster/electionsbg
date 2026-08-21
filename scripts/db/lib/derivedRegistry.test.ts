// Static consistency gate for the derived-object registry (cloud-deploy-speed-v1
// §v2-c). No Postgres — runs in test:unit. It cannot yet check "inputs covers what
// the rebuilder actually reads" (that needs the live function bodies, a job for the
// resolver's data test in v2-d); what it CAN do is keep the catalog internally
// honest and pinned to the one list that is already verified — scopedMatviews.ts.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DERIVED_OBJECTS,
  SYNC_CLASS,
  ACCUMULATOR_TABLES,
  type DerivedObject,
} from "./derivedRegistry";
import { SCOPED_MATVIEWS } from "./scopedMatviews";

const ROOT = path.resolve(__dirname, "../../..");

const npmScripts = (): Set<string> => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  return new Set(Object.keys(pkg.scripts));
};

describe("derived-object registry", () => {
  it("is non-vacuous", () => {
    expect(DERIVED_OBJECTS.length).toBeGreaterThan(15);
    expect(ACCUMULATOR_TABLES.length).toBeGreaterThan(4);
  });

  it("every object is well-formed (name, migration, ≥1 input, ≥1 rebuilder)", () => {
    const bad = DERIVED_OBJECTS.filter(
      (o: DerivedObject) =>
        !o.name ||
        !o.migration ||
        o.inputs.length === 0 ||
        o.rebuiltBy.length === 0,
    ).map((o) => o.name || "(unnamed)");
    expect(bad, "objects missing a name/migration/input/rebuilder").toEqual([]);
  });

  it("object names are unique", () => {
    const seen = new Set<string>();
    const dupes = DERIVED_OBJECTS.map((o) => o.name).filter((n) => {
      if (seen.has(n)) return true;
      seen.add(n);
      return false;
    });
    expect(dupes, "duplicate object names in the registry").toEqual([]);
  });

  it("no object lists itself as its own input (would loop the resolver)", () => {
    const self = DERIVED_OBJECTS.filter((o) => o.inputs.includes(o.name)).map(
      (o) => o.name,
    );
    expect(self, "an object cannot be built from itself").toEqual([]);
  });

  it("every rebuiltBy is a real npm script (base name, no :cloud)", () => {
    const scripts = npmScripts();
    const missing = [
      ...new Set(DERIVED_OBJECTS.flatMap((o) => o.rebuiltBy)),
    ].filter((s) => !scripts.has(s));
    expect(
      missing,
      "rebuiltBy entries that name no npm script — a rebuilder must be runnable, " +
        "and use the base name (the resolver appends :cloud), not a :cloud alias",
    ).toEqual([]);
  });

  it("no rebuiltBy carries a :cloud suffix (the resolver adds it)", () => {
    const cloudy = DERIVED_OBJECTS.flatMap((o) => o.rebuiltBy).filter((s) =>
      s.endsWith(":cloud"),
    );
    expect(
      cloudy,
      "rebuiltBy must be the base script name, not the :cloud alias",
    ).toEqual([]);
  });

  it("agrees with scopedMatviews.ts on the four per-scope precomputes", () => {
    // The narrow list in scopedMatviews.ts is already verified against
    // pg_get_functiondef (procurement_payloads.data.test.ts). Pinning this wider
    // registry to it means the two cannot drift: an inputs edit in one that is not
    // mirrored in the other fails here.
    // Widened to string keys deliberately: SCOPED_MATVIEWS is `as const`, so an
    // inferred Map would key on the six literal names and `get(o.name)` — a plain
    // string off the wider registry — would not typecheck.
    const scoped = new Map<string, string[]>(
      SCOPED_MATVIEWS.map((m) => [m.name, [...m.inputs].sort()]),
    );
    const disagreements: string[] = [];
    for (const o of DERIVED_OBJECTS) {
      const s = scoped.get(o.name);
      if (!s) continue; // only the objects present in BOTH lists
      const here = [...o.inputs].sort();
      // the registry may legitimately carry MORE inputs than the scoped list only
      // if it is a superset; for these four they must match exactly.
      if (JSON.stringify(here) !== JSON.stringify(s))
        disagreements.push(`${o.name}: registry=[${here}] scoped=[${s}]`);
    }
    expect(
      disagreements,
      "the registry and scopedMatviews.ts disagree on a scoped matview's inputs — " +
        "update both",
    ).toEqual([]);
  });

  it("every scoped matview in scopedMatviews.ts is present in the registry", () => {
    const names = new Set(DERIVED_OBJECTS.map((o) => o.name));
    // contractor_scope_kpis and procurement_geo_payloads are the second half of
    // their pairs and share the first's inputs/rebuilders; the registry catalogs
    // the pair by its lead matview, so only the leads must be present.
    const leads = [
      "procurement_settlement_rank",
      "contractor_rank",
      "procurement_payloads",
    ];
    const missing = leads.filter((n) => !names.has(n));
    expect(
      missing,
      "a lead scoped matview is absent from the registry",
    ).toEqual([]);
  });

  it("SYNC_CLASS values are a valid enum and ACCUMULATOR_TABLES is derived from it", () => {
    const bad = Object.entries(SYNC_CLASS).filter(
      ([, c]) => c !== "mirror" && c !== "accumulator",
    );
    expect(bad, "invalid sync class").toEqual([]);
    const expected = Object.entries(SYNC_CLASS)
      .filter(([, c]) => c === "accumulator")
      .map(([t]) => t)
      .sort();
    expect([...ACCUMULATOR_TABLES].sort()).toEqual(expected);
  });

  it("the known upsert-only accumulators are classified (R1 / F56)", () => {
    // These are the tables CLAUDE.md documents as upsert-only / never-delete, where
    // cloud is a permanent superset of local. If a future refactor drops one from
    // SYNC_CLASS, a delta-ship would default it to a DELETE-safe mirror and could
    // erase the cloud-only rows (F56's council_resolution, the unregenerable
    // kzk_appeals outcomes). Require each to be present AND classified accumulator.
    const mustBeAccumulator = [
      "council_resolution",
      "open_calls",
      "kzk_appeals",
      "ted_notice",
      "price_last_seen",
      "person_slug_retired",
    ];
    const wrong = mustBeAccumulator.filter(
      (t) => SYNC_CLASS[t] !== "accumulator",
    );
    expect(
      wrong,
      "these are upsert-only accumulators (cloud ⊇ local) and MUST be classified " +
        "so a delta-ship never runs its DELETE arm against them — see F56",
    ).toEqual([]);
  });

  it("no accumulator is also a DERIVED object (the two are disjoint by nature)", () => {
    // An accumulator is a base, upsert-only / partially-sourced table; a derived
    // object is RECOMPUTED, so cloud == local after its rebuild. A name in both
    // lists is a contradiction — the recompute would overwrite the accumulation.
    // (This replaces a tautological "mirror ∩ accumulator" check: ACCUMULATOR_TABLES
    // is derived from SYNC_CLASS, so that intersection could never be non-empty.)
    const derivedNames = new Set(DERIVED_OBJECTS.map((o) => o.name));
    const both = ACCUMULATOR_TABLES.filter((t) => derivedNames.has(t));
    expect(
      both,
      "a table is classified as an upsert-only accumulator AND catalogued as a " +
        "recomputed derived object — pick one",
    ).toEqual([]);
  });
});
