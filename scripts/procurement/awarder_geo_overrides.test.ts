// Invariants of the committed override map itself.
//
// This is the file the 2026-08-10 incident corrupted, and nothing asserted
// anything about it — the shrink was caught by hand-diffing against git. These
// checks are cheap and catch a bad write directly. They reuse `countSources`
// and `SOURCE_RANK` from the writer's own module rather than restating them, so
// the gate cannot drift from the code that produces the file.
//
// A plain unit test on purpose: the artifact is committed JSON, so this needs
// no Postgres and none of the `.data.test.ts` skip-when-down machinery.
//
// The last check is a RATCHET rather than a unit test — see MAX_UNAVAILABLE_DAYS.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { assertCommitted } from "../lib/assert_committed";
import {
  countSources,
  SOURCE_RANK,
  tierAgeDays,
  TIER_KEYS,
  type GeoEntry,
} from "./awarder_geo_merge";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(
  __dirname,
  "../../data/procurement/awarder_geo_overrides.json",
);

interface Overrides {
  generatedAt: string;
  count: number;
  sources: Record<string, number>;
  run: { candidates: number; resolved: number; unresolved: number };
  carriedOver: Record<string, number>;
  tiers: Record<
    string,
    { status: string; reason?: string; lastFreshAt?: string }
  >;
  notes?: string[];
  awarders: Record<string, GeoEntry>;
}

const load = (): Overrides =>
  JSON.parse(fs.readFileSync(FILE, "utf8")) as Overrides;

// How long a tier may sit `unavailable` before the gate goes red.
//
// A tier that cannot run does NOT shrink the map — `mergeGeoOverrides` carries
// its entries forward, and that is correct: ЕИК↔EKATTE is stable, so an entry
// resolved last week is still right today. The price is that the outage is
// invisible. The artifact keeps a healthy `count`, every other tier stamps
// today, and the only trace is one stderr line plus a field nobody reads —
// which is how Tier B (МОН open data, 403 from data.egov.bg) sat `unavailable`
// for 16 days unnoticed. See docs/plans/egov-tierb-block-v1.md.
//
// So: allow the carry, bound how long it may ride. Same shape and the same
// generosity as scripts/macro/degraded.test.ts, which solves the identical
// defect class for the macro artifacts' `degraded` marker — an outage lasting
// longer than this is not a blip, and at that point the right response is
// investigating a retired endpoint, not another re-run.
//
// One caveat before tuning this: on the bootstrap it inherits ~3 days of
// optimism (a down tier's stamp falls back to the PRIOR build's `generatedAt`,
// and on the `mon` bootstrap that build's tier was already dark — 13.5d stamped
// against 15.9d true, plan §2b). So 14 here fires at ~17 real days the first
// time, and correctly thereafter.
const MAX_UNAVAILABLE_DAYS = 14;

// OUTSIDE any gate, deliberately — these are COMMITTED, so absence is a broken
// working copy rather than a supported state. See scripts/lib/assert_committed.ts.
assertCommitted("data/procurement/awarder_geo_overrides.json");

describe("awarder_geo_overrides.json", () => {
  it("exists and is non-empty", () => {
    // The map is the whole point of the builder; an empty one means every
    // address-less buyer has left by_settlement and the place tiles.
    expect(fs.existsSync(FILE)).toBe(true);
    expect(Object.keys(load().awarders).length).toBeGreaterThan(1000);
  });

  it("has a count that matches the map it describes", () => {
    const j = load();
    expect(j.count).toBe(Object.keys(j.awarders).length);
  });

  it("has a sources block that reproduces exactly", () => {
    const j = load();
    expect(j.sources).toEqual(countSources(j.awarders));
    const summed = Object.values(j.sources).reduce((a, b) => a + b, 0);
    expect(summed).toBe(j.count);
  });

  it("carries no entry from an unrecognised tier", () => {
    // A renamed tier would otherwise land here unnoticed and be carried
    // forever, since the merge cannot verify a tier it cannot name.
    const unknown = [
      ...new Set(
        Object.values(load().awarders)
          .map((e) => e.source)
          .filter((s) => SOURCE_RANK[s] === undefined),
      ),
    ];
    expect(unknown).toEqual([]);
  });

  it("has every entry carrying an ekatte and a confidence", () => {
    const bad = Object.entries(load().awarders).filter(
      ([, e]) => !e.ekatte || !e.confidence,
    );
    expect(bad).toEqual([]);
  });

  it("never claims more carried-over entries than it holds", () => {
    const j = load();
    for (const [label, n] of Object.entries(j.carriedOver))
      expect(n, `carriedOver.${label}`).toBeLessThanOrEqual(
        j.sources[label] ?? 0,
      );
  });

  it("declares every tier, and gives a reason for each unavailable one", () => {
    const j = load();
    // A named failure rather than the bare `TypeError` that `Object.keys` throws
    // — the pre-2026-08-10 artifacts genuinely have no `tiers` block, so anyone
    // bisecting or reverting hits this.
    expect(j.tiers, "artifact has no `tiers` block").toBeDefined();
    // EXACT, not superset: the writer builds `tiers` from TIER_KEYS, so a key
    // here that TIER_KEYS does not name is a stale artifact or a renamed tier.
    // It also closes a hole between this test and the ratchet below, which
    // iterates the ARTIFACT's keys rather than TIER_KEYS — without this, an
    // unrecognised key carrying an unrecognised status (`"blocked"`, or a typo'd
    // `"unavailble"`) is validated by neither: this loop never visits it and the
    // ratchet's `!== "unavailable"` skips it.
    expect(Object.keys(j.tiers).sort()).toEqual([...TIER_KEYS].sort());
    for (const key of TIER_KEYS) {
      const t = j.tiers[key];
      expect(t, `tiers.${key}`).toBeDefined();
      expect(["ok", "unavailable"]).toContain(t.status);
      // An unavailable tier without a reason is the state that reads as a
      // mystery weeks later, when the carried entries are the only symptom.
      if (t.status === "unavailable") expect(t.reason).toBeTruthy();
    }
  });

  it("has a run block whose tally reconciles", () => {
    const j = load();
    expect(j.run.resolved + j.run.unresolved).toBe(j.run.candidates);
  });

  it("keeps the run's tally separate from the map's — not summed into it", () => {
    // `sources` describes the map, `run` describes the run, and they disagree
    // exactly when a tier is down. A build that folded `unresolved` back into
    // `sources` would break the reproduce-exactly check above; this pins the
    // reason, so the split survives a future edit.
    const j = load();
    expect(j.sources.unresolved).toBeUndefined();
  });

  it("carries no tier that has been unavailable longer than the ratchet allows", () => {
    // ⚠ AGE FROM `lastFreshAt`, NEVER FROM `generatedAt`. This INVERTS the
    // macro precedent deliberately. degraded.test.ts ages from the artifact's
    // own `fetchedAt` so that re-running during a prolonged outage resets the
    // clock and it only fires when nobody re-ran at all. Here that would be
    // exactly backwards: this artifact is rebuilt on every procurement ingest
    // and stamps a fresh `generatedAt` every time — measured, 8 rebuilds in 13
    // days while Tier B never came back. `lastFreshAt` is the only field that
    // tracks the thing that is actually stale.
    //
    // Deliberately wall-clock-dependent, against the determinism rule in
    // docs/testing-standards.md — a ratchet has to be, and degraded.test.ts is
    // the sanctioned precedent. Do not "fix" it into a fixed-instant test:
    // pinning the clock is precisely what stops it ever firing.
    //
    // Vacuous when every tier is healthy, and that is the intended resting
    // state — there is no non-vacuity assertion to add here, because "some
    // tier is down" is not a property this file should ever require.
    const j = load();
    for (const [key, t] of Object.entries(j.tiers)) {
      if (t.status !== "unavailable") continue;
      // A stamp that cannot be aged fails rather than skips — the safe
      // direction. Note it is very nearly unreachable, and NOT the guarantee it
      // looks like: awarder_geo_map.ts backfills a down tier from
      // `prior.generatedAt`, so a tier that has never resolved anything arrives
      // with an inherited, misleadingly fresh stamp and receives the full grace
      // below. That optimism belongs to the writer (plan §2b), and closing it
      // means changing how the stamp is written, not this assertion.
      expect(
        t.lastFreshAt,
        `tiers.${key}: unavailable with no lastFreshAt to age it`,
      ).toBeTruthy();
      // The age rule is a pure helper so its branches can be unit-tested with
      // frozen inputs (awarder_geo_merge.test.ts) instead of by mutating this
      // git-tracked artifact. NaN on an unparseable date fails this too.
      const ageDays = tierAgeDays(t.lastFreshAt, Date.now());
      expect(
        ageDays,
        // ONE DECIMAL, not toFixed(0): at 14.1d — the very first fire — rounding
        // renders "14d" against a "14d" threshold, which reads as an off-by-one
        // and invites someone to loosen the comparison.
        `tiers.${key} has been unavailable for ${ageDays.toFixed(1)}d ` +
          `(${t.reason ?? "no reason recorded"}). Its entries are being carried ` +
          `forward unverified. Rebuild the map:\n` +
          `  npx tsx scripts/procurement/awarder_geo_map.ts\n` +
          `That restamps this gate but does NOT reach by_settlement or the place ` +
          `tiles — for that the map needs an ingest, and it must be the FULL ` +
          `current-value chain from the update-procurement skill. A bare ` +
          `procurement:ingest recomputes amountEur = toEur(amount) and silently ` +
          `drops the post-annex fold.\n` +
          `If the upstream is still blocked after ${MAX_UNAVAILABLE_DAYS}d, read ` +
          `docs/plans/egov-tierb-block-v1.md — the tier may need repairing or ` +
          `retiring rather than another re-run.`,
      ).toBeLessThan(MAX_UNAVAILABLE_DAYS);
    }
  });
});
