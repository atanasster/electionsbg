// The watcher's contract, modelled on interreg_calls.test.ts: a source that is
// DOWN must never be reported as a source that CHANGED.
//
// `fingerprint()` fetches, so these test `describe()` and the invariants around
// it directly — which is where the false-signal defect lived.

import { describe, expect, it } from "vitest";
import { mcDkiRegister } from "./mc_dki_register";
import type { Fingerprint, WatchState } from "../types";

const fp = (count: number, down: string[] = []): Fingerprint => ({
  value: `v-${count}-${down.join(",")}`,
  detail: `${count} държавни културни институти listed`,
  meta: { count, down },
});

const state = (f: Fingerprint): WatchState =>
  ({
    fingerprint: f.value,
    value: f.value,
    detail: f.detail,
    meta: f.meta,
    lastChecked: "2026-08-19",
    lastChanged: "2026-08-19",
  }) as unknown as WatchState;

/** `describe` is optional on WatchSource; this source declares one, and a
 *  refactor that dropped it would silently disable every assertion below. */
const describeOf = (prev: WatchState | null, curr: Fingerprint): string => {
  if (!mcDkiRegister.describe)
    throw new Error("mcDkiRegister no longer declares describe()");
  return mcDkiRegister.describe(prev, curr);
};

describe("mcDkiRegister", () => {
  it("declares publishes, so the cadence ratchet binds", () => {
    // Optional only because 100+ sources predate the field; a NEW source
    // shipping without one re-opens the hole cadence.test.ts exists to close.
    expect(mcDkiRegister.publishes).toBeDefined();
  });

  it("reports a genuine addition and removal", () => {
    expect(describeOf(state(fp(70)), fp(72))).toMatch(/added 2/);
    expect(describeOf(state(fp(70)), fp(68))).toMatch(/removed 2/);
  });

  it("does NOT report a removal when a page was unreachable", () => {
    // The defect: one of three pages timing out reported „32 ДКИ listed (was
    // 70) — МК removed 38", persisted it, then reported „МК added 38" on
    // recovery. Two false data events from one outage.
    const said = describeOf(state(fp(70)), fp(32, ["theatre"]));
    expect(said).not.toMatch(/removed/);
    expect(said).toMatch(/different set of pages/);
    expect(said).toMatch(/theatre/);
  });

  it("does NOT report an addition when a page comes back", () => {
    const said = describeOf(state(fp(32, ["theatre"])), fp(70));
    expect(said).not.toMatch(/added/);
    expect(said).toMatch(/different set of pages/);
  });

  it("still compares when the same page is down in both runs", () => {
    // Coverage is what must match, not health — two runs missing the same page
    // are comparable to each other.
    expect(describeOf(state(fp(32, ["theatre"])), fp(34, ["theatre"]))).toMatch(
      /added 2/,
    );
  });

  it("calls an unchanged count a rename", () => {
    expect(describeOf(state(fp(70)), fp(70))).toMatch(/renamed/);
  });

  it("reports the first observation as its own detail", () => {
    expect(describeOf(null, fp(70))).toBe(fp(70).detail);
  });
});
