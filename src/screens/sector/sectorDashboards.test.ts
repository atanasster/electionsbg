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

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MZ_EIK, NZOK_EIK } from "@/lib/healthReferenceData";
import { getSectorPack } from "@/screens/components/procurement/sectorPacks";
import { stripComments } from "../../../scripts/lib/strip_comments";

const SCREEN_SRC = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../dev/CompanyDbScreen.tsx",
  ),
  "utf8",
);
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

describe("the two lookups stay wired to their own concern", () => {
  // The lookups are behaviourally IDENTICAL on today's data for every input that
  // matters, because no non-lead member has a pack. So swapping them at the call
  // site changes nothing observable and leaves every test in this file green —
  // asserted against source for the same reason PersonProfileScreen.noindex does
  // it: the failure is a one-token edit, and rendering CompanyDbScreen to catch it
  // would mean standing up ~40 fetching tiles.
  it("showPack keys on LEAD and the cross-link on MEMBERSHIP, in the source", () => {
    expect(SCREEN_SRC).toMatch(
      /sectorDash = useMemo\(\(\) => sectorDashboardForLeadEik\(eik\), \[eik\]\)/,
    );
    expect(SCREEN_SRC).toMatch(/showPack = SectorPack && !sectorDash/);
    expect(SCREEN_SRC).toMatch(/sectorDashboardForMemberEik\(eik\)/);
    // The swap that would silently suppress the pack for all 161 members.
    expect(SCREEN_SRC).not.toMatch(
      /showPack = SectorPack && !sectorMembership/,
    );
    // …and the swap that would put the dead end back for every non-lead member.
    expect(SCREEN_SRC).not.toMatch(/isAwarderRoute && sectorDash \?/);
    expect(SCREEN_SRC).toMatch(/isAwarderRoute && sectorMembership \?/);
  });

  it("no non-lead member has a registered domain pack", () => {
    // `showPack` is `SectorPack && !sectorDashboardForLeadEik(eik)` — deliberately
    // the LEAD lookup, because a lead's pack has moved to /sector/:id. Keying it on
    // membership instead would suppress the pack for every non-lead member, and
    // today that swap is INVISIBLE: no member currently has a pack, so nothing
    // would render differently and no test would fail.
    //
    // This asserts the coincidence rather than relying on it. The day a sector
    // grows a second packed body — which is exactly what health did by admitting
    // МЗ — the mistake stops being free, and this names the EIK instead of
    // silently blanking that body's page.
    const nonLead = Object.values(SECTOR_DASHBOARDS).flatMap((c) =>
      c.members.filter((m) => m.eik !== c.leadEik).map((m) => ({ c, m })),
    );
    // Floor the set actually SCANNED, not a neighbouring one: a roster change that
    // empties every `members` array would otherwise pass with zero subjects.
    expect(nonLead.length).toBeGreaterThan(150);
    // …and floor the resolver too, so an inert getSectorPack cannot make the
    // filter below return nothing for the wrong reason.
    expect(
      Object.values(SECTOR_DASHBOARDS).filter((c) => getSectorPack(c.leadEik))
        .length,
    ).toBeGreaterThan(5);

    const packed = nonLead
      .filter(({ m }) => getSectorPack(m.eik))
      .map(({ c, m }) => `${c.id}:${m.eik}`);
    expect(packed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// packOwnsScope — the flag that decides who renders the page's time control.
//
// SectorDashboardScreen suppresses its own <ScopeControl> for a pack-backed
// sector carrying this flag, on the promise that the PACK renders one instead.
// Nothing in the type system holds that promise, and every way of breaking it is
// silent: a flagged pack that renders no control leaves the page with NO time
// control, an unflagged pack that renders one leaves it with TWO, and an
// UNCONTROLLED <ScopeControl> in a flagged pack is worse than either — it runs
// its own useScope() with no support, resolves ?pscope against every year since
// 2011, and paints a year the pack cannot render. That last one IS the shipped
// defect: the pill read „2022" above „…митническите приходи (2025)" and €7,4 млрд.
//
// ⚠️ THE SOURCE SCANS STRIP COMMENTS. The first cut of this gate asserted
// `toContain("<ScopeControl")` over raw source, and CustomsPack mentions that
// string twice IN PROSE — so the gate passed for a pack with the JSX deleted, for
// an uncontrolled control, and for one with its year narrowing dropped, all three
// verified against the real files. CLAUDE.md names the shared primitive for
// exactly this: „prose that MENTIONS a pattern is not an occurrence of it."

const PACK_SRC: Record<string, string> = {
  customs: "../components/procurement/customs/CustomsPack.tsx",
  revenue: "../components/procurement/nap/NapPack.tsx",
};

const atDir = (rel: string) =>
  path.join(path.dirname(fileURLToPath(import.meta.url)), rel);

const readStripped = (rel: string) =>
  stripComments(readFileSync(atDir(rel), "utf8"));

const SECTOR_SCREEN_SRC = stripComments(
  readFileSync(atDir("SectorDashboardScreen.tsx"), "utf8"),
);

describe("packOwnsScope", () => {
  const flagged = () =>
    Object.values(SECTOR_DASHBOARDS).filter((c) => c.packOwnsScope);

  it("is set only on sectors that actually have a pack", () => {
    // Floor the subject set locally: `[] === []` also passes when NO sector
    // carries the flag, which is the absence-equivalent state.
    expect(flagged().length).toBeGreaterThan(0);
    const inert = flagged()
      .filter((c) => !getSectorPack(c.leadEik))
      .map((c) => c.id);
    expect(inert).toEqual([]);
  });

  it("is never combined with packIsThematic", () => {
    // A thematic pack does NOT replace the page: the generic group dashboard
    // above it is scope-driven and needs the screen's control. The screen's
    // guard keys on `Pack`, which is null for a thematic pack — so the screen
    // would render one AND the pack its own. Two controls again. The
    // "has a pack" test above cannot see this, because getSectorPack resolves a
    // thematic pack too.
    const both = flagged()
      .filter((c) => c.packIsThematic)
      .map((c) => c.id);
    expect(both).toEqual([]);
  });

  it("the screen suppresses its own control for a flagged pack", () => {
    // The other half of the contract. Without this, replacing the guard with
    // `{true && (` — a one-token edit restoring the two-control state — leaves
    // every other test here green.
    expect(SECTOR_SCREEN_SRC).toContain("!(Pack && config.packOwnsScope)");
    // …and the suppression must stay scoped to the FLAG. Widening it to every
    // pack would strip the control from НЗОК / ВиК / МВР, whose group dashboards
    // are scope-driven and mount no control of their own.
    expect(SECTOR_SCREEN_SRC).not.toMatch(
      /\{!Pack && \(\s*<div className="mb-3">/,
    );
  });

  it("keeps the screen's own control for every other sector", () => {
    const packedButUnflagged = Object.values(SECTOR_DASHBOARDS).filter(
      (c) => getSectorPack(c.leadEik) && !c.packOwnsScope,
    );
    expect(packedButUnflagged.length).toBeGreaterThan(5);
  });

  it("covers exactly the packs that own their scope, and each is WIRED", () => {
    const ids = flagged()
      .map((c) => c.id)
      .sort();
    // Floor the subject set so a config wipe cannot pass this vacuously, and
    // keep PACK_SRC in step with it.
    expect(ids).toEqual(["customs", "revenue"]);
    expect(Object.keys(PACK_SRC).sort()).toEqual(ids);

    for (const id of ids) {
      const src = readStripped(PACK_SRC[id]);
      // Routed through the ONE hook that pairs the resolved scope with the
      // control built from it. Matching `<ScopeControl` instead would pass for a
      // bare uncontrolled one, which is the original defect.
      expect(src, `${id} pack does not use usePackScope`).toMatch(
        /usePackScope\(/,
      );
      // …and it must render what the hook returned. A pack that calls the hook
      // and drops `strip` leaves the page with no control at all.
      expect(src, `${id} pack never renders the scope strip`).toMatch(
        /\{strip\}/,
      );
      // …in EVERY branch, including its own early returns. The screen's
      // suppression is structural while a pack's content waits on a lazy chunk
      // and a fetch, so a skeleton or a failed corpus would otherwise take the
      // page's only time control with it. Three branches: loading, empty, main.
      expect(
        src.match(/\{strip\}/g)?.length ?? 0,
        `${id} pack renders the scope strip in fewer than all three branches`,
      ).toBeGreaterThanOrEqual(3);
      // Nothing may assemble the control by hand beside the hook.
      expect(src, `${id} pack mounts a ScopeControl of its own`).not.toMatch(
        /<ScopeControl/,
      );
    }
  });

  it("suppresses the pack wherever a second control already exists", () => {
    // CompanyDbScreen mounts its own ScopeControl AND resolves a pack by EIK, so
    // a flagged pack rendering there would be the two-control state again. It is
    // safe only because `showPack = SectorPack && !sectorDash` drops the pack for
    // any awarder that leads a sector dashboard — asserted once above, at the
    // `showPack` test; what this pins is the other half, that every flagged
    // sector's lead really does resolve to a dashboard.
    for (const c of flagged())
      expect(sectorDashboardForLeadEik(c.leadEik)?.id).toBe(c.id);
  });
});
