// The member→sector index, and the invariants the /awarder/:eik cross-link rests on.
//
// `sectorDashboardForMemberEik` answers "which sector does this awarder belong to?"
// — the question that was previously asked of the LEAD index, which is why every
// non-lead member of a multi-member sector was a dead end. Two properties of it are
// load-bearing and neither is enforced by the type system:
//
//   · it must claim each EIK exactly once (a body attributed to a sector by object
//     key order is a wrong claim about who spends the money), and
//   · it must be a strict superset of the lead index, or a lead loses its own
//     membership banner while keeping pack suppression — green everywhere, one page
//     quietly wrong.

import { describe, expect, it } from "vitest";
import { MZ_EIK, NZOK_EIK } from "@/lib/healthReferenceData";
import {
  buildMemberIndex,
  sectorDashboardForLeadEik,
  sectorDashboardForMemberEik,
  sectorMemberEiks,
  SECTOR_DASHBOARDS,
  type SectorDashboardConfig,
} from "./sectorDashboards";

// A config's members are what the index keys on; nothing else here matters.
const cfg = (id: string, eiks: string[]): SectorDashboardConfig =>
  ({
    ...SECTOR_DASHBOARDS.health,
    id,
    members: eiks.map((eik) => ({ eik, name: { bg: eik, en: eik } })),
  }) as SectorDashboardConfig;

describe("buildMemberIndex", () => {
  it("refuses one EIK claimed by two sectors, naming both", () => {
    expect(() => buildMemberIndex([cfg("a", ["1"]), cfg("b", ["1"])])).toThrow(
      /"a" and "b"/,
    );
  });

  it("refuses two DISTINCT sectors that share an id", () => {
    // The reason the guard compares object identity rather than `prev.id !== c.id`:
    // nothing enforces that a config's `id` matches its SECTOR_DASHBOARDS key, so
    // the copy-paste slip that duplicates an entry and forgets to rename the inner
    // `id` is exactly what an id-based check would wave through.
    expect(() =>
      buildMemberIndex([cfg("dup", ["1"]), cfg("dup", ["1"])]),
    ).toThrow(/must claim it exclusively/);
  });

  it("refuses a sector that lists its own EIK twice", () => {
    // Harmless to the index, but it reaches the reader as two chips and a
    // double-counted member, and nothing else in the codebase catches it.
    expect(() => buildMemberIndex([cfg("solo", ["1", "1"])])).toThrow(
      /lists EIK 1 twice/,
    );
  });

  it("accepts a clean set, and the live config is one", () => {
    expect(() =>
      buildMemberIndex([cfg("a", ["1", "2"]), cfg("b", ["3"])]),
    ).not.toThrow();
    expect(() =>
      buildMemberIndex(Object.values(SECTOR_DASHBOARDS)),
    ).not.toThrow();
  });

  it("returns a null-prototype map, so inherited keys cannot resolve", () => {
    const idx = buildMemberIndex([cfg("a", ["1"])]);
    expect(idx["toString"]).toBeUndefined();
    expect(Object.getPrototypeOf(idx)).toBeNull();
  });
});

describe("sectorDashboardForMemberEik", () => {
  it("resolves a non-lead member — the case the split exists for", () => {
    // МЗ: €2.84bn, health's non-lead member since 2026-08-16, and the page that
    // made this gap visible.
    expect(sectorDashboardForMemberEik(MZ_EIK)?.id).toBe("health");
    expect(sectorDashboardForLeadEik(MZ_EIK)).toBeNull();
  });

  it("still resolves a lead — it is a superset, not an alternative", () => {
    expect(sectorDashboardForMemberEik(NZOK_EIK)?.id).toBe("health");
    expect(sectorDashboardForLeadEik(NZOK_EIK)?.id).toBe("health");
  });

  it("is a strict superset: every leadEik is in its own members", () => {
    // Asserted rather than assumed. A sector whose lead is omitted from `members`
    // would keep pack suppression (lead index) and silently lose the membership
    // banner (member index) on its own page.
    for (const c of Object.values(SECTOR_DASHBOARDS))
      expect(sectorDashboardForMemberEik(c.leadEik)?.id).toBe(c.id);
  });

  it("claims each member EIK exactly once across the whole config", () => {
    const all = Object.values(SECTOR_DASHBOARDS).flatMap(sectorMemberEiks);
    expect(all.length).toBeGreaterThan(150); // else this is absence-equivalent
    expect(new Set(all).size).toBe(all.length);
  });

  it("matches the lead helper's tolerance for junk input", () => {
    // "toString" et al. are the reason both maps are null-prototype: /awarder/:eik
    // is an unvalidated route param, and a plain object hands back
    // Function.prototype.toString typed as a config.
    for (const v of [
      null,
      undefined,
      "",
      "000000000",
      "toString",
      "__proto__",
    ]) {
      expect(sectorDashboardForMemberEik(v)).toBeNull();
      expect(sectorDashboardForLeadEik(v)).toBeNull();
    }
  });
});
