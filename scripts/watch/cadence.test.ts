// Guards the watcher's sampling invariant: a source must be PROBED at least
// twice per upstream PUBLICATION period.
//
// The bug this exists to prevent: `eurostat` carried `cadence: "monthly"` while
// bundling prc_hicp_minr, a monthly HICP release. Eurostat published July 2026
// on 2026-07-31; the watcher had probed on 2026-07-16 and was not due again
// until 2026-08-14. `/indicators` served a stale quarter for a fortnight, and
// nothing failed — the daily report cheerfully listed it under "Skipped
// (off-cadence)" the whole time. A too-slow cadence is invisible at runtime by
// construction, so it has to be caught here.
//
// No network: this reads source metadata only. Runs in the `node` Vitest
// project (see docs/testing-standards.md).

import { describe, expect, it } from "vitest";
import { SOURCES } from "./sources/index";
import {
  CADENCE_WINDOW_MS,
  PUBLISH_PERIOD_MS,
  cadenceViolation,
  dueForCheck,
} from "./cadence";
import type { PublishFrequency, WatchState } from "./types";

describe("cadenceViolation", () => {
  it("rejects sampling a monthly release monthly — the eurostat bug", () => {
    expect(cadenceViolation("monthly", "monthly")).toMatch(/too slow/);
  });

  it("accepts a weekly or faster probe of a monthly release", () => {
    expect(cadenceViolation("weekly", "monthly")).toBeNull();
    expect(cadenceViolation("daily", "monthly")).toBeNull();
  });

  it("rejects a weekly probe of a weekly release", () => {
    // Nyquist, not "strictly faster": a 6-day window against a 7-day release
    // still leaves a release unseen for nearly a week.
    expect(cadenceViolation("weekly", "weekly")).toMatch(/too slow/);
    expect(cadenceViolation("daily", "weekly")).toBeNull();
  });

  it("exempts genuinely irregular upstreams", () => {
    expect(cadenceViolation("monthly", "irregular")).toBeNull();
  });

  it("names a cadence that would satisfy the invariant", () => {
    expect(cadenceViolation("monthly", "monthly")).toMatch(/Use "weekly"/);
  });

  it("prices every band except the irregular exemption", () => {
    // Enumerated explicitly, NOT derived from Object.keys(PUBLISH_PERIOD_MS):
    // iterating the map's own entries can only ever confirm what is already
    // there, so a band added to PublishFrequency and forgotten here would slip
    // through. Listing them makes that a failure rather than a silent pass.
    const BANDS: PublishFrequency[] = [
      "daily",
      "weekly",
      "monthly",
      "quarterly",
      "semiannual",
      "annual",
      "irregular",
    ];
    for (const band of BANDS) {
      if (band === "irregular") {
        expect(cadenceViolation("monthly", band)).toBeNull();
        continue;
      }
      expect(
        PUBLISH_PERIOD_MS[band],
        `no period for band "${band}"`,
      ).toBeGreaterThan(0);
    }
  });

  it("prices the slower bands, which no source exercises densely", () => {
    // semiannual is the only period picked by hand (182d) rather than from a
    // calendar unit, and eurostat_energy_prices depends on it in production.
    expect(cadenceViolation("monthly", "quarterly")).toBeNull();
    expect(cadenceViolation("monthly", "semiannual")).toBeNull();
    expect(cadenceViolation("monthly", "annual")).toBeNull();
    // A quarterly release still cannot be sampled monthly-and-a-bit: 29d × 2
    // = 58d fits inside 90d, so monthly is the slowest band that qualifies.
    expect(PUBLISH_PERIOD_MS.quarterly).toBeGreaterThan(
      CADENCE_WINDOW_MS.monthly * 2,
    );
  });
});

describe("SOURCES cadence vs. upstream publication", () => {
  const declared = SOURCES.filter((s) => s.publishes);

  it("has sources declaring their upstream frequency", () => {
    // Cheap tripwire: if a refactor drops the field, the per-source loop below
    // would silently pass with an empty set.
    expect(declared.length).toBeGreaterThan(0);
  });

  it.each(declared.map((s) => [s.id, s] as const))(
    "%s is probed fast enough for its upstream",
    (_id, src) => {
      const violation = cadenceViolation(src.cadence, src.publishes!);
      expect(violation, `${src.id}: ${violation}`).toBeNull();
    },
  );

  it("keeps HICP on a cadence that catches a monthly release", () => {
    // Pinned by name, not just by the generic rule above: this is the bundle
    // that actually went stale, and it is the one whose freshness the
    // /indicators inflation figures depend on.
    const src = SOURCES.find((s) => s.id === "eurostat");
    expect(src, "eurostat source missing from SOURCES").toBeDefined();
    expect(src!.publishes).toBe("monthly");
    expect(CADENCE_WINDOW_MS[src!.cadence]).toBeLessThanOrEqual(
      PUBLISH_PERIOD_MS.monthly / 2,
    );
  });

  it("never regresses the number of sources declaring `publishes`", () => {
    // Ratchet. `publishes` is optional only because 100+ sources predate it,
    // so nothing stops a NEW source shipping without one — which re-opens the
    // exact hole this file exists to close. Bump this upward as sources are
    // annotated; never downward.
    const DECLARED_FLOOR = 12;
    const declaredNow = SOURCES.filter((s) => s.publishes).length;
    expect(
      declaredNow,
      `${declaredNow} sources declare 'publishes'; floor is ${DECLARED_FLOOR}. ` +
        `If you added a source, declare its upstream frequency; if you annotated ` +
        `more, raise the floor.`,
    ).toBeGreaterThanOrEqual(DECLARED_FLOOR);
  });

  it("uses unique source ids", () => {
    // Two sources sharing an id would share one state/watch/<id>.json and
    // overwrite each other's fingerprint every run.
    const ids = SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("dueForCheck", () => {
  const state = (lastChecked: string): WatchState => ({
    fingerprint: "x",
    detail: "d",
    lastChecked,
    lastChanged: lastChecked,
  });
  const T0 = Date.parse("2026-08-03T00:00:00Z");

  it("always fires on first run", () => {
    expect(dueForCheck(null, "monthly", T0)).toBe(true);
  });

  it("skips inside the window and fires once past it", () => {
    const twoDaysAgo = new Date(T0 - 2 * 86400_000).toISOString();
    expect(dueForCheck(state(twoDaysAgo), "weekly", T0)).toBe(false);
    expect(dueForCheck(state(twoDaysAgo), "daily", T0)).toBe(true);
  });

  it("honours the hourly band", () => {
    // The only cadence no source currently uses, so nothing else covers it.
    const fifty = new Date(T0 - 50 * 60_000).toISOString();
    const fiftySix = new Date(T0 - 56 * 60_000).toISOString();
    expect(dueForCheck(state(fifty), "hourly", T0)).toBe(false);
    expect(dueForCheck(state(fiftySix), "hourly", T0)).toBe(true);
  });

  it("allows a daily source to fire on a ~24h routine (grace)", () => {
    // The grace exists so a run that starts a few minutes late doesn't push a
    // daily source to every OTHER day. 23h55m must still be due.
    const almost = new Date(T0 - (23 * 3600_000 + 55 * 60_000)).toISOString();
    expect(dueForCheck(state(almost), "daily", T0)).toBe(true);
  });
});
