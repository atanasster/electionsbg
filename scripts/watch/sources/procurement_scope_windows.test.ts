// Tests the scope-window rollover fingerprint (cloud-deploy-speed-v1 §v2-g / A3).
// Pure — exercises the extracted helper so the Jan-1 / new-election behaviour is
// verifiable without waiting for a real date change.

import { describe, expect, it } from "vitest";
import {
  scopeWindowFingerprint,
  procurementScopeWindows,
} from "./procurement_scope_windows";
import { SOURCES } from "./index";

const elections = ["2021_04_04", "2026_04_19"];

describe("procurement scope-window watcher", () => {
  it("is stable for the same year + elections", () => {
    expect(scopeWindowFingerprint(2026, elections).value).toBe(
      scopeWindowFingerprint(2026, [...elections].reverse()).value,
    );
  });

  it("changes on the Jan-1 calendar rollover (a new year)", () => {
    const a = scopeWindowFingerprint(2026, elections).value;
    const b = scopeWindowFingerprint(2027, elections).value;
    expect(a).not.toBe(b);
  });

  it("changes when a new election window is added", () => {
    const a = scopeWindowFingerprint(2026, elections).value;
    const b = scopeWindowFingerprint(2026, [...elections, "2027_10_01"]).value;
    expect(a).not.toBe(b);
  });

  it("reports the window counts in its detail + meta", () => {
    const fp = scopeWindowFingerprint(2026, elections);
    // 2011..2026 inclusive = 16 year windows
    expect(fp.meta?.yearCount).toBe(16);
    expect(fp.meta?.electionCount).toBe(2);
    expect(fp.detail).toContain("16 year window");
    expect(fp.detail).toContain("2 election window");
  });

  it("derives its value from the shared allScopeWindows keys (no third representation)", () => {
    const fp = scopeWindowFingerprint(2026, elections);
    // keys are `all`, then y:<year> ascending, then ns:<name> newest-first
    expect(fp.value.startsWith("all,y:2011,")).toBe(true);
    expect(fp.value).toContain("ns:2026_04_19");
    expect(fp.meta?.windowCount).toBe(1 + 16 + 2); // all + years + elections
  });

  it("is registered with a daily cadence and an annual publish period, and in SOURCES", () => {
    expect(procurementScopeWindows.id).toBe("procurement_scope_windows");
    expect(procurementScopeWindows.cadence).toBe("daily");
    expect(procurementScopeWindows.publishes).toBe("annual");
    expect(
      SOURCES.some((s) => s.id === "procurement_scope_windows"),
      "must be wired into the SOURCES array or the watcher never runs it",
    ).toBe(true);
  });

  it("describe() carries the exact fix command, only on a real change", () => {
    const curr = scopeWindowFingerprint(2027, elections);
    const baseline = procurementScopeWindows.describe!(null, curr);
    expect(baseline).toContain("baseline");
    const prev = {
      fingerprint: scopeWindowFingerprint(2026, elections).value,
      detail: "",
      lastChecked: "2026-12-31T00:00:00Z",
      lastChanged: "2026-12-31T00:00:00Z",
    };
    const changed = procurementScopeWindows.describe!(prev, curr);
    expect(changed).toContain("db:load:procurement-scopes:pg:cloud");
  });

  it("fingerprint() resolves against the committed elections.json without network", async () => {
    const fp = await procurementScopeWindows.fingerprint();
    expect(Number(fp.meta?.electionCount)).toBeGreaterThan(0);
    expect(fp.value.startsWith("all,y:2011,")).toBe(true);
  });
});
