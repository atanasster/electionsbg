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
//
// The module has since grown two more contracts, each under its own banner below:
// `packOwnsScope` (who renders the page's time control) and
// `packRendersOwnContractsLink` (who routes the reader to the buy-side).
//
// ⚠️ EVERY SOURCE SCAN IN THIS FILE STRIPS COMMENTS. Prose that MENTIONS a
// pattern is not an occurrence of it — CLAUDE.md names the shared primitive for
// exactly this, and the gate below was already satisfied by comment prose once.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MZ_EIK, NZOK_EIK } from "@/lib/healthReferenceData";
import {
  getSectorPack,
  getSectorBrowsePack,
} from "@/screens/components/procurement/sectorPacks";
import { stripComments } from "../../../scripts/lib/strip_comments";

import {
  buildMemberIndex,
  sectorDashboardForLeadEik,
  sectorDashboardForMemberEik,
  sectorMemberEiks,
  SECTOR_DASHBOARDS,
  type SectorDashboardConfig,
} from "./sectorDashboards";

/** A path relative to this test file. The one place the module resolves paths. */
const atDir = (rel: string) =>
  path.join(path.dirname(fileURLToPath(import.meta.url)), rel);

/** Read a source file with its comments removed — see the ⚠️ in the header. */
const readStripped = (rel: string) =>
  stripComments(readFileSync(atDir(rel), "utf8"));

const SCREEN_SRC = readStripped("../dev/CompanyDbScreen.tsx");
const SECTOR_SCREEN_SRC = readStripped("SectorDashboardScreen.tsx");

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
  agri: "../components/procurement/agri/AgriPack.tsx",
  customs: "../components/procurement/customs/CustomsPack.tsx",
  revenue: "../components/procurement/nap/NapPack.tsx",
};

// TWO wirings satisfy packOwnsScope, and both are checked below — but never
// interchangeably, because they make DIFFERENT promises about an off-list year:
//
//   usePackScope  (customs, revenue) — RESOLVES `?pscope` against the years the
//     pack can serve and hands the same resolved value to the control, so an
//     off-list year silently re-anchors to one the pack has.
//   useAgriScope  (agri) — reads the scope UNRESOLVED, deliberately: /subsidies
//     answers a year the CAP corpus lacks with an explicit „няма данни за 2019"
//     and KEEPS that year in the pill rather than re-anchoring. The hook and
//     <ScopeControl> pass the same (absent) support argument, so the pill and the
//     numbers are still one value — which is the property packOwnsScope is about.
//     Forcing agri onto usePackScope would delete that named-gap state.
//
// What both must guarantee is that the control renders in EVERY branch. The
// usePackScope packs do it by repeating `{strip}` in each early return; AgriPack
// does it STRUCTURALLY, by mounting <AgriScopePicker /> outside <AgriScopeFallback>,
// which is where all three non-ready states live. Position is the assertion there.
// ⚠ POSITION ESTABLISHES ORDERING, NOT UNCONDITIONALITY, so all five checks below
// are load-bearing. The first cut asserted only „picker before gate" and three
// mutations walked straight through it, each verified against the real source: a
// picker behind a `ready`-only conditional; a SECOND uncontrolled <ScopeControl>
// added beside it; and the picker swapped for a bare <ScopeControl />, which
// resolves `?pscope` against every year since 2011 — verbatim the shipped customs
// defect this whole flag exists to prevent.
const AGRI_SCOPE_WIRED = (src: string): string[] => {
  const bad: string[] = [];
  if (!/useAgriScope\(/.test(src)) bad.push("does not use useAgriScope");
  const picker = src.indexOf("<AgriScopePicker");
  const fallback = src.indexOf("<AgriScopeFallback");
  if (picker < 0) bad.push("never renders <AgriScopePicker />");
  if (fallback < 0) bad.push("never renders <AgriScopeFallback>");
  // 1. The picker sits ABOVE the gate, so the three non-ready states cannot take
  //    the page's only time control with them.
  if (picker >= 0 && fallback >= 0 && picker > fallback)
    bad.push("renders its scope picker INSIDE the gate, so a failed or empty scope leaves no control"); // prettier-ignore
  // 2. …and it is UNCONDITIONAL. `{x && <AgriScopePicker` is the same defect one
  //    token further out: the control vanishes exactly when the payload does.
  const line = src.split("\n").find((l) => l.includes("<AgriScopePicker"));
  if (line && !/^\s*<AgriScopePicker/.test(line))
    bad.push(`renders its scope picker conditionally: ${line.trim()}`);
  // 3. Exactly one. Two controls is the state packOwnsScope exists to end.
  const n = src.match(/<AgriScopePicker/g)?.length ?? 0;
  if (n > 1) bad.push(`renders ${n} scope pickers`);
  // 4. Nothing mounts a raw <ScopeControl> beside it — the usePackScope arm asserts
  //    this too, and the `continue` below used to skip it for agri. A bare one
  //    resolves `?pscope` against every year since 2011 instead of the CAP years.
  if (/<ScopeControl/.test(src))
    bad.push("mounts a ScopeControl of its own beside the picker");
  return bad;
};

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
    expect(ids).toEqual(["agri", "customs", "revenue"]);
    expect(Object.keys(PACK_SRC).sort()).toEqual(ids);

    for (const id of ids) {
      const src = readStripped(PACK_SRC[id]);
      // agri takes the second wiring — see AGRI_SCOPE_WIRED's header for why the
      // two are not interchangeable.
      if (id === "agri") {
        expect(AGRI_SCOPE_WIRED(src), `agri pack scope wiring`).toEqual([]);
        continue;
      }
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

// ---------------------------------------------------------------------------
// packRendersOwnContractsLink — who routes the reader to the buy-side.
//
// A pack IS the page: the branch that renders one skips the KPI row, the
// top-contractors tile AND the `/procurement/contracts?sector=` drill-down every
// non-pack sector gets from its KPI cards. (The awarders tile renders for every
// sector, outside that branch.) So the screen adds that one link back — unless
// the pack already links there, which five of them do.
//
// ⚠️ THE FLAG IS DERIVED FROM THE PACK SOURCES HERE, not trusted. Both kinds of
// drift are invisible on the page a developer happens to open: a pack that grows
// its own contracts link leaves a duplicate under it, and a pack that loses one
// leaves the sector with no route to its buy-side at all while the hub tile still
// promises „договори" — which is the defect this link exists to fix (Митници:
// €262.0M over 1,222 contracts, reachable only by typing the browse URL).
//
// ⚠️ THE SECTOR→PACK JOIN IS ON THE EIK CONSTANT IDENTIFIER, never on a naming
// convention. The first cut matched a lowercase prefix of the pack's component
// name through a hand-written hint map, and an unresolvable join `continue`d —
// so renaming MvrPack dropped `security` out of the sweep with the test still
// green (the size floor counts the MAP, not the sectors checked), and
// `judiciary`→VssPack / `pensions`→NoiPack would have been skipped silently the
// day they graduate. `[MVR_EIK]: MvrPack` in the registry and `leadEik: MVR_EIK`
// here share one token verbatim, so joining on it needs no convention and no
// forecast — and an id that still fails to resolve is now an assertion.

/** Every pack-backed sector that actually renders its pack as the page. A
 *  thematic pack sits BELOW the generic dashboard, which carries the KPI row and
 *  its own contracts drill-down, so it is not in this contract. */
const packBackedIds = () =>
  Object.values(SECTOR_DASHBOARDS)
    .filter((c) => getSectorPack(c.leadEik) && !c.packIsThematic)
    .map((c) => c.id)
    .sort();

/** EIK-constant identifier (e.g. "MVR_EIK") → the pack module's path, read out of
 *  the registry's own lazy imports and PACKS map. */
const packSources = (): Map<string, string> => {
  const src = stripComments(
    readFileSync(atDir("../components/procurement/sectorPacks.tsx"), "utf8"),
  );
  const byComponent = new Map<string, string>();
  for (const m of src.matchAll(
    /const (\w+) = lazy\(\(\) =>\s*import\("(\.[^"]+)"\)/g,
  ))
    byComponent.set(m[1], m[2]);
  const out = new Map<string, string>();
  for (const m of src.matchAll(/\[(\w+)\]:\s*(\w+Pack),/g)) {
    const rel = byComponent.get(m[2]);
    if (rel) out.set(m[1], rel); // key on the EIK constant, not the component
  }
  return out;
};

/** sector id → the EIK-constant identifier its `leadEik` is written with, read
 *  out of this registry's own source. The other half of the same-token join. */
const leadEikIdents = (): Map<string, string> => {
  const src = stripComments(readFileSync(atDir("sectorDashboards.ts"), "utf8"));
  const out = new Map<string, string>();
  for (const m of src.matchAll(
    /^ {2}(\w+): \{$[\s\S]*?^ {4}leadEik: (\w+),$/gm,
  ))
    out.set(m[1], m[2]);
  return out;
};

/** Does any file in the pack's OWN directory link to the contracts browser?
 *  Directory-wide, not entry-file-only: several packs delegate a drill-down to a
 *  sibling tile (NzokPack imports 18 of them), and a link there is still a link
 *  the reader sees — read as "absent" it would put a duplicate on the page. */
const packLinksToContracts = (rel: string): boolean => {
  const dir = path.dirname(
    atDir(`../components/procurement/${rel.slice(2)}.tsx`),
  );
  return readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .some((f) =>
      stripComments(readFileSync(path.join(dir, f), "utf8")).includes(
        "procurement/contracts",
      ),
    );
};

describe("packRendersOwnContractsLink", () => {
  it("matches what each pack's source actually does", () => {
    const sources = packSources();
    const idents = leadEikIdents();
    // Floor both sides of the join, and — the part the first cut missed — the
    // number of sectors actually CHECKED, below.
    expect(sources.size).toBeGreaterThan(8);
    expect(idents.size).toBeGreaterThan(8);

    const wrong: string[] = [];
    const unresolved: string[] = [];
    let checked = 0;
    for (const id of packBackedIds()) {
      const rel = sources.get(idents.get(id) ?? "");
      // A sector whose pack cannot be located is UNVERIFIED, not compliant.
      if (!rel) {
        unresolved.push(id);
        continue;
      }
      checked += 1;
      const linksItself = packLinksToContracts(rel);
      const declared =
        SECTOR_DASHBOARDS[id].packRendersOwnContractsLink === true;
      if (linksItself !== declared)
        wrong.push(
          `${id}: pack ${linksItself ? "DOES" : "does NOT"} link to the contracts browser, config says ${declared}`,
        );
    }
    expect(
      unresolved,
      "sector→pack join failed; the EIK constant must match",
    ).toEqual([]);
    // Non-vacuity: `wrong === []` is also what a sweep that checked nothing
    // returns, and that is exactly how the first cut passed after a rename.
    expect(checked).toBe(packBackedIds().length);
    expect(checked).toBeGreaterThan(5);
    expect(wrong).toEqual([]);
  });

  it("leaves at least one sector relying on the screen's link", () => {
    // The whole point. If every pack linked out itself the screen's link would be
    // dead code — and if the flag were set everywhere by accident, the four
    // collector/delivery packs would go back to hiding their buy-side.
    const relying = packBackedIds().filter(
      (id) => !SECTOR_DASHBOARDS[id].packRendersOwnContractsLink,
    );
    expect(relying).toEqual(["customs", "health", "revenue", "roads"]);
  });

  it("is never set on a thematic sector, where it is inert", () => {
    // A thematic pack sets `Pack = null`, so the screen's link never renders and
    // this flag does nothing — until someone removes packIsThematic, at which
    // point a stale `true` silently hides that sector's buy-side. packBackedIds()
    // filters thematic sectors out, so the sweep above cannot see this either.
    const inert = Object.values(SECTOR_DASHBOARDS)
      .filter((c) => c.packIsThematic && c.packRendersOwnContractsLink)
      .map((c) => c.id);
    expect(inert).toEqual([]);
  });

  it("the link lives INSIDE the Pack arm, gated on the flag", () => {
    // Presence of the two tokens is not enough: moving the link below
    // <SectorAwardersTile /> — outside the branch, guard intact — would add it to
    // every non-pack sector, duplicating the drill-down their KPI cards already
    // carry. That is the /sector/security duplicate this flag removed, mirrored.
    expect(SECTOR_SCREEN_SRC).toMatch(
      /<Pack eik=\{config\.leadEik\}[\s\S]{0,400}?!config\.packRendersOwnContractsLink && \([\s\S]{0,200}?<PackContractsLink/,
    );
  });

  it("does not forward a scope the pack never rendered", () => {
    // A packOwnsScope pack clamps ?pscope in memory and never writes it back, so
    // the raw param can name a window the page above did not show.
    expect(SECTOR_SCREEN_SRC).toMatch(
      /if \(config\.packOwnsScope\) contractsSearch\.delete\("pscope"\);/,
    );
  });

  it("every sector's ?sector= id is a registered browse pack", () => {
    // Unregistered → getSectorBrowsePack returns null → the browse page serves
    // the UNFILTERED corpus, under a card captioned with one institution's name:
    // ~800k contracts presented as Агенция „Митници“'s. A wrong claim, not a
    // wide one — which is why this matters more now than for the pre-existing
    // „виж всички" chip that shares the id.
    const unregistered = Object.values(SECTOR_DASHBOARDS)
      .filter((c) => !getSectorBrowsePack(c.browsePackId ?? c.id))
      .map((c) => c.id);
    expect(unregistered).toEqual([]);
  });
});

// „държавно" on the leaderboard — who may carry a curated state-body list, and
// where the screen has to hand it over.
//
// The field is read in exactly ONE place: the generic KPI/leaderboard branch of
// SectorDashboardScreen. That branch is mutually exclusive with the pack arm
// (`Pack ? … : …`), so on a pack-backed sector a list set here is curated,
// committed and never rendered — the sibling flags above carry the same shape of
// guard for the same reason. Only three sectors reach the branch today (tourism,
// energy, and edu via packIsThematic), and SECURITY/SOCIAL/ADMIN all have curated
// lists of their own already, so setting one on the wrong sector is a plausible
// next edit rather than a hypothetical.
describe("stateBodyContractors", () => {
  /** The sectors whose generic KPI/leaderboard branch actually renders. */
  const genericBranch = (c: SectorDashboardConfig) =>
    !!c.packIsThematic || !getSectorPack(c.leadEik);

  const flagged = () =>
    Object.values(SECTOR_DASHBOARDS).filter((c) => c.stateBodyContractors);

  it("is set only where the generic leaderboard actually renders", () => {
    // Floor the subject set locally, exactly as packOwnsScope does: `[] === []`
    // also passes when NO sector carries a list, the absence-equivalent state.
    expect(flagged().length).toBeGreaterThan(0);
    const inert = flagged().filter((c) => !genericBranch(c));
    expect(inert.map((c) => c.id)).toEqual([]);
  });

  it("never names one of the sector's own members", () => {
    // A member is a BUYER here, and the tile drops a listed EIK from its state
    // bodies when it is also a member, preferring „в групата". So an EIK in both
    // places is a silently unused entry. Checked against the array the SCREEN
    // reads (sectorMemberEiks → config.members), not a reference-data roster:
    // those are separately maintained and coincide only at one member.
    for (const c of Object.values(SECTOR_DASHBOARDS)) {
      const members = new Set(sectorMemberEiks(c));
      for (const e of c.stateBodyContractors ?? [])
        expect(
          members.has(e),
          `${c.id}: ${e} is both a member and a curated state body`,
        ).toBe(false);
    }
  });

  it("holds plain, deduped 9- or 13-digit EIKs", () => {
    for (const c of Object.values(SECTOR_DASHBOARDS)) {
      const list = c.stateBodyContractors;
      if (!list) continue;
      expect(new Set(list).size, c.id).toBe(list.length);
      for (const e of list)
        expect(e, `${c.id}: ${e}`).toMatch(/^(\d{9}|\d{13})$/);
    }
  });

  it("the screen hands it to the tile from the ONE place it builds it", () => {
    // The source-scan half. The prop list used to be written twice, once per
    // layout arm, and only the fallback arm was covered by a render test — so the
    // grid arm (which every sector with ≥2 years of spend renders) could have
    // lost the prop with the whole suite green. Building the element once is what
    // removed that class; this asserts it stays built once.
    const src = SECTOR_SCREEN_SRC;
    const passes = src.match(/stateBodyEiks=\{config\.stateBodyContractors\}/g);
    expect(passes).toHaveLength(1);
    expect(src).toContain("const topTile =");
    // …and that neither layout arm re-inlines the tile with its own props.
    expect(src.match(/<SectorTopContractorsTile/g)).toHaveLength(1);
  });
});
