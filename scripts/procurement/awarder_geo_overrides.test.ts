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

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  countSources,
  SOURCE_RANK,
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
});
