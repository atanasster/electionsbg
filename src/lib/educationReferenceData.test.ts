// The education roster's PG-FREE invariants — structure, the anti-allowlist's two
// halves, and the three surfaces that read the roster (the dashboard members, the
// browse pack, the pinned display names).
//
// Split from scripts/db/tests/sector_stats_education.data.test.ts deliberately:
// everything here is decidable from the source alone, so it belongs in the fast
// unit suite where it fails in seconds on a machine with no database. That file
// keeps what genuinely needs the corpus (is each EIK a real awarder, does the group
// € stay in band, does any contractor dominate) plus the committed-artifact
// reconcile. Mirrors src/lib/regionalReferenceData.test.ts.
//
// Audit: docs/plans/education-sector-audit-v1.md (2026-08-18).

import { describe, expect, it } from "vitest";
import { SECTOR_DASHBOARDS } from "@/screens/sector/sectorDashboards";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";
import {
  AWARDER_NAME_OVERRIDES,
  canonicalAwarderName,
} from "./awarderNameOverrides";
import {
  EDU_SECTOR_EIKS,
  EDU_ENTITIES,
  EDU_LEAD_EIK,
  EDU_INSTITUTION_COUNT,
  EDU_UNIVERSES,
  EDUCATION_EXTERNAL_HIGHER_SCHOOLS,
  educationFootnote,
  educationEntityByEik,
  educationUniverseOf,
  type EducationUniverse,
} from "./educationReferenceData";

describe("EDU_ENTITIES — structure", () => {
  it("is one row per distinct, well-formed EIK, led by МОН", () => {
    expect(new Set(EDU_SECTOR_EIKS).size).toBe(EDU_SECTOR_EIKS.length);
    expect(EDU_ENTITIES[0].eik).toBe(EDU_LEAD_EIK);
    expect(EDU_ENTITIES[0].universe).toBe("ministry");
    for (const e of EDU_ENTITIES) {
      expect(e.eik, `malformed EIK on ${e.name}`).toMatch(/^\d{9,13}$/);
      expect(e.name.trim(), `empty name on ${e.eik}`).not.toBe("");
    }
    // A floor, so an emptied roster cannot satisfy every check below by having
    // nothing to check. 126 at the audit; the pre-audit set was 1.
    expect(EDU_SECTOR_EIKS.length).toBeGreaterThanOrEqual(110);
  });

  it("counts institutions apart from EIKs", () => {
    // Свищов changed EIK in 2016 and both halves of its history are kept — the
    // contract sets are disjoint in time, so nothing double-counts. Reader-facing
    // prose quotes the INSTITUTION count, and conflating the two published a wrong
    // number once already („34 държавни висши училища" for 33).
    const retired = EDU_ENTITIES.filter((e) => e.retiredEikOf);
    expect(retired.length).toBeGreaterThanOrEqual(1);
    expect(EDU_INSTITUTION_COUNT).toBe(EDU_ENTITIES.length - retired.length);

    // Each retired row must name a LIVE member, or the pair stops describing one
    // institution and the count silently drifts again.
    const live = new Set(
      EDU_ENTITIES.filter((e) => !e.retiredEikOf).map((e) => e.eik),
    );
    for (const r of retired)
      expect(live.has(r.retiredEikOf!), `${r.eik} → ${r.retiredEikOf}`).toBe(
        true,
      );
  });

  it("populates every universe", () => {
    // A Record-keyed rank makes a MISSING universe a compile error; this is the
    // runtime half — one that type-checks and holds no members, so its section of
    // the awarders tile silently disappears.
    const byU = new Map<EducationUniverse, number>();
    for (const e of EDU_ENTITIES)
      byU.set(e.universe, (byU.get(e.universe) ?? 0) + 1);
    expect(EDU_UNIVERSES.filter((u) => !byU.get(u))).toEqual([]);
    expect(byU.get("higher_education")).toBeGreaterThanOrEqual(30);
    expect(byU.get("research_ban")).toBeGreaterThanOrEqual(40);
  });

  it("resolves lookups by EIK", () => {
    expect(educationEntityByEik(EDU_LEAD_EIK)?.universe).toBe("ministry");
    expect(educationUniverseOf("000670680")).toBe("higher_education");
    expect(educationEntityByEik("999999999")).toBeUndefined();
  });
});

describe("the anti-allowlist — both halves", () => {
  it("keeps externally-held bodies out", () => {
    const set = new Set(EDU_SECTOR_EIKS);
    const leaked = [
      ...EDUCATION_EXTERNAL_HIGHER_SCHOOLS.map((e) => [e.eik, e.name] as const),
      // Two near-misses that are not higher schools, so not in that list.
      ["000663814", "НИМХ — left БАН in 2019, environment set"] as const,
      ["131177220", "Национален институт на правосъдието — judiciary"] as const,
    ].filter(([eik]) => set.has(eik));
    expect(leaked.map(([eik, name]) => `${eik} (${name})`)).toEqual([]);
  });

  it("proves every exclusion is REALLY claimed by the sector it names", () => {
    // THE assertion this file exists for. "Excluded because sector X owns it" is a
    // CLAIM, and the roster's first cut got it wrong for six institutions:
    // kulturaReferenceData carries an EXCLUDED_EIKS ANTI-allowlist, so grepping an
    // EIK there finds it whether culture claims it or disclaims it. Six bodies were
    // excluded "to culture" while culture named THIS sector as their owner —
    // stranding them in no sector at all, the very defect the roster fixes.
    const claims = new Map<string, string[]>();
    for (const [id, c] of Object.entries(SECTOR_DASHBOARDS))
      for (const m of c.members)
        claims.set(m.eik, [...(claims.get(m.eik) ?? []), id]);
    for (const p of Object.values(SECTOR_BROWSE_PACKS))
      for (const e of p.eiks) claims.set(e, [...(claims.get(e) ?? []), p.id]);

    expect(EDUCATION_EXTERNAL_HIGHER_SCHOOLS.length).toBeGreaterThanOrEqual(4);
    const unowned = EDUCATION_EXTERNAL_HIGHER_SCHOOLS.filter(
      (e) => !(claims.get(e.eik) ?? []).includes(e.sector),
    ).map(
      (e) =>
        `${e.eik} (${e.name}) excluded to "${e.sector}", owners: ${(claims.get(e.eik) ?? ["NONE"]).join(", ")}`,
    );
    expect(unowned).toEqual([]);
  });

  it("keeps the six culture-adjacent bodies IN, in the right universe", () => {
    // The converse pin, so a tidy-up that re-reads culture's anti-allowlist as an
    // allowlist fails here instead of shipping. A museum-institute filed under
    // higher_education would also inflate the university count in the footnote.
    const RESTORED: Array<[string, string, EducationUniverse]> = [
      ["000670716", "Национална художествена академия", "higher_education"],
      ["000670709", "Национална музикална академия", "higher_education"],
      ["000670723", "НАТФИЗ", "higher_education"],
      ["000670919", "НАИМ с музей — БАН", "research_ban"],
      ["175905773", "ИЕФЕМ — БАН", "research_ban"],
      ["000665612", "Национален природонаучен музей — БАН", "research_ban"],
    ];
    for (const [eik, name, universe] of RESTORED)
      expect(educationUniverseOf(eik), `${name} (${eik})`).toBe(universe);
  });
});

describe("the surfaces that read the roster", () => {
  it("keeps the three EIK-set copies in lockstep", () => {
    const dash = SECTOR_DASHBOARDS.edu;
    const pack = SECTOR_BROWSE_PACKS.edu;
    const ref = [...EDU_SECTOR_EIKS].sort();
    expect([...dash.members.map((m) => m.eik)].sort()).toEqual(ref);
    expect([...pack.eiks].sort()).toEqual(ref);
    expect(dash.leadEik).toBe(EDU_LEAD_EIK);
  });

  it("renders the group dashboard, not the thematic pack, as the page", () => {
    // Nothing else can see this. getSectorPack(leadEik) resolves MonPack, which
    // normally makes the pack BE the page and passes `enabled: !Pack` to
    // useAwarderGroupModel — so without the flag the group model is never fetched
    // and NONE of the roster's numbers reach a reader, while every other gate here
    // stays green. MonPack is the cross-buyer textbook analysis and does not even
    // bind its `eik` prop.
    expect(SECTOR_DASHBOARDS.edu.packIsThematic).toBe(true);
  });

  it("carries a DERIVED footnote naming what the tile's € excludes", () => {
    const fn = SECTOR_DASHBOARDS.edu.footnote;
    expect(fn).toBeTruthy();
    // Derived, not hand-typed: RegionalPack's hand-written footnote said 28 in
    // Bulgarian and 27 in English for one roster.
    expect(fn!.bg).toBe(educationFootnote(true));
    expect(fn!.en).toBe(educationFootnote(false));

    for (const text of [fn!.bg, fn!.en]) {
      expect(text).toContain(String(EDU_INSTITUTION_COUNT));
      expect(text).toContain("БАН");
      // The bodies a reader would expect here and will find elsewhere — without
      // these the page implies the roster is the whole ЗВО list.
      for (const e of EDUCATION_EXTERNAL_HIGHER_SCHOOLS)
        expect(text).toContain(e.name);
    }
  });

  it("states an external-school count that matches the list", () => {
    // The count was hard-coded („Четири"/„Four") while the NAME LIST beside it was
    // derived, so a fifth exclusion would have shipped a footnote saying four and
    // listing five — in both languages, with all 13 tests green.
    const n = EDUCATION_EXTERNAL_HIGHER_SCHOOLS.length;
    expect(/(\d+) държавни висши училища са в друг/.exec(educationFootnote(true))?.[1]).toBe(String(n)); // prettier-ignore
    expect(/(\d+) state higher schools/.exec(educationFootnote(false))?.[1]).toBe(String(n)); // prettier-ignore
  });

  it("counts universities, not university EIKs, in the footnote", () => {
    // The prose bug this whole retiredEikOf mechanism exists to stop.
    const institutions = EDU_ENTITIES.filter(
      (e) => e.universe === "higher_education" && !e.retiredEikOf,
    ).length;
    const eiks = EDU_ENTITIES.filter(
      (e) => e.universe === "higher_education",
    ).length;
    expect(eiks).toBeGreaterThan(institutions); // else the check is vacuous
    expect(educationFootnote(true)).toContain(`${institutions} държавни висши`);
    expect(educationFootnote(false)).toContain(`${institutions} state higher`);
  });

  it("pins the two names the corpus resolves WRONG", () => {
    // ⚠ Asserting "every member's name is in AWARDER_NAME_OVERRIDES" is a
    // TAUTOLOGY and was one here: the edu block is built as
    // Object.fromEntries(EDU_ENTITIES.map(e => [e.eik, e.name])) and spread last,
    // so it compares a derivation to its own source and stays green through any
    // rename. What is worth asserting is the OUTCOME on the two EIKs the corpus
    // resolves to the wrong body — 123024538 to „Медицински факултет към
    // Тракийски университет" (one faculty standing in for the whole university
    // across 1,320 contracts) and 831917453 to „„Студентски столове и общежития"
    // ЕАД ЕАД" — read through the public accessor, which is what the awarder page
    // calls.
    expect(canonicalAwarderName("123024538")).toBe(
      "Тракийски университет — Стара Загора",
    );
    expect(canonicalAwarderName("831917453")).toBe(
      "„Студентски столове и общежития“ ЕАД (ССО)",
    );
  });

  it("does not shadow another sector's pinned name", () => {
    // The collision risk of folding a second roster into one override map: the edu
    // block is spread LAST, so an EIK it shares with the МВР/АСП pair or with
    // REGIONAL_OVERRIDES silently wins, renaming another sector's institution from
    // this file.
    //
    // ⚠ Honest scope: for every override key that exists TODAY this is
    // defence-in-depth, because all of them are also dashboard members and
    // sectorDashboards.ts throws at module load on a double-claimed EIK — verified
    // by mutation (adding АГКК 130362903 here dies at import, not here). What this
    // covers is the residual the guard cannot see: an override key that is NOT a
    // dashboard member, which is exactly what a future hand-added pin would be.
    const eduEiks = new Set(EDU_SECTOR_EIKS);
    const foreign = Object.keys(AWARDER_NAME_OVERRIDES).filter(
      (eik) =>
        eduEiks.has(eik) &&
        AWARDER_NAME_OVERRIDES[eik] !== educationEntityByEik(eik)?.name,
    );
    expect(foreign).toEqual([]);
    // Non-vacuity: the map really does hold entries from both rosters.
    expect(Object.keys(AWARDER_NAME_OVERRIDES).length).toBeGreaterThan(
      EDU_SECTOR_EIKS.length,
    );
  });

  it("lets no roster annotation become a page title", () => {
    // canonicalAwarderName() is the HIGHEST-priority name on /awarder/:eik and
    // /company/:eik, so anything written for the roster chip becomes an <h1>.
    // „…Свищов (предишен ЕИК, 2011-2015)" shipped once; retiredEikOf is where that
    // fact belongs.
    const annotated = EDU_ENTITIES.filter((e) =>
      /предишен|стар[о]? наименование|бивш|\(\s*\d{4}\s*-\s*\d{4}\s*\)/i.test(
        e.name,
      ),
    ).map((e) => `${e.eik}: ${e.name}`);
    expect(annotated).toEqual([]);
  });
});
