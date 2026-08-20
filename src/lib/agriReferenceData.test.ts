// Unit gate for the Земеделие (МЗХ) roster. No Postgres — this file asserts the
// SHAPE of the reference data and the honesty of its exclusions; the €-and-corpus
// assertions live in scripts/db/tests/sector_stats.data.test.ts.
//
// The second describe below is why this file exists at all: the roster's first cut
// excluded ИА по горите „to environment" on the strength of a grep, when
// environmentReferenceData.ts's ADJACENT-BUT-EXCLUDED block names AGRICULTURE as
// its owner — stranding the whole forestry administration (28 EIKs, €73.3M) in no
// sector. The education audit documents the identical failure and gates it; that
// prose was copied into agriReferenceData.ts's header while the gate was not, so
// the half the docstring calls "the one that matters" was the half being violated.

import { describe, it, expect } from "vitest";
import {
  AGRI_ENTITIES,
  AGRI_SECTOR_EIKS,
  AGRI_EXTERNAL_BODIES,
  AGRI_UNIVERSE_LABEL,
  AGRI_UNIVERSES,
  AGRI_BODY_COUNT,
  AGRI_LEAD_EIK,
  agriFootnote,
  agriEntityByEik,
  agriUniverseOf,
} from "./agriReferenceData";
import { SECTOR_DASHBOARDS } from "@/screens/sector/sectorDashboards";
import { SECTOR_BROWSE_PACKS } from "@/screens/components/procurement/sectorPacks";

describe("the roster's shape", () => {
  it("has no duplicate EIKs", () => {
    // A duplicate would double-weight that body the day the array drives a per-EIK
    // fan-out — the judiciary pack shipped exactly that (121513231 and 181092349
    // each in twice) and it went unnoticed because an IN (...) filter hides it.
    const seen = new Map<string, number>();
    for (const e of AGRI_ENTITIES) seen.set(e.eik, (seen.get(e.eik) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([eik]) => eik)).toEqual([]);
  });

  it("stores every EIK in the 9–13 digit form the API accepts", () => {
    // `/api/db/awarder-group-model` filters on /^\d{9,13}$/, so a mistyped or
    // space-padded EIK is dropped SILENTLY — the rollup just quietly omits that
    // body's money rather than erroring.
    expect(AGRI_SECTOR_EIKS.filter((e) => !/^\d{9,13}$/.test(e))).toEqual([]);
  });

  it("leads with ДФЗ, which is a member of its own roster", () => {
    // SectorDashboardScreen resolves the lead BY EIK rather than trusting index 0,
    // and falls back to members[0] — so a lead absent from the roster puts another
    // body's name on the buy-side link.
    expect(AGRI_SECTOR_EIKS).toContain(AGRI_LEAD_EIK);
    expect(AGRI_ENTITIES[0]?.eik).toBe(AGRI_LEAD_EIK);
  });

  it("labels every universe it uses, and uses every universe it ranks", () => {
    const used = new Set(AGRI_ENTITIES.map((e) => e.universe));
    expect([...used].filter((u) => !AGRI_UNIVERSE_LABEL[u])).toEqual([]);
    // AGRI_UNIVERSES is what a segmentation picker would render. A universe with
    // no members must not appear in it (an empty bucket), and one WITH members
    // must — otherwise those units are unreachable through the picker.
    expect([...AGRI_UNIVERSES].sort()).toEqual([...used].sort());
  });

  it("counts LIVE bodies, not EIKs, for reader-facing prose", () => {
    // They differ by the succeeded-body rows. The education footnote said
    // „34 държавни висши училища" for 33 until this distinction existed.
    const succeeded = AGRI_ENTITIES.filter((e) => e.succeededBy).length;
    expect(succeeded).toBeGreaterThan(0);
    expect(AGRI_BODY_COUNT).toBe(AGRI_ENTITIES.length - succeeded);
    // …and a succeeded body must name a successor that is really in the roster.
    const set = new Set(AGRI_SECTOR_EIKS);
    expect(
      AGRI_ENTITIES.filter((e) => e.succeededBy && !set.has(e.succeededBy)).map(
        (e) => e.eik,
      ),
    ).toEqual([]);
  });

  it("exposes working per-EIK lookups", () => {
    expect(agriEntityByEik(AGRI_LEAD_EIK)?.universe).toBe("paying_agency");
    expect(agriUniverseOf("176040023")).toBe("food_safety");
    expect(agriUniverseOf("121486802")).toBe("forestry");
    expect(agriEntityByEik("000000000")).toBeUndefined();
  });
});

describe("the anti-allowlist — both halves", () => {
  it("keeps externally-held bodies out", () => {
    const set = new Set(AGRI_SECTOR_EIKS);
    const leaked = [
      ...AGRI_EXTERNAL_BODIES.map((e) => [e.eik, e.name] as const),
      // Near-misses a `%земедел%` / `%храни%` name sweep returns that are NOT in
      // that list, because no sector "owns" them as agriculture bodies: the
      // agricultural VOCATIONAL SCHOOLS. Each is МОН/municipal.
      ["000847248", 'ПГ по земеделие „Тодор Рачински"'] as const,
      ["000183295", 'ПГ по земеделие „Стефан Цанов" — Кнежа'] as const,
      ["000014128", 'ЗПГ „Климент Аркадиевич Тимирязев"'] as const,
      ["000559000", 'ПЗГ „Добруджа"'] as const,
      // A ССА institute and a НАЦИОНАЛЕН park — the two sharpest traps in the set.
      ["000840410", "Добруджански земеделски институт — ССА, edu"] as const,
      ["115772635", "Институт по тютюна — ССА, edu"] as const,
    ].filter(([eik]) => set.has(eik));
    expect(leaked.map(([eik, name]) => `${eik} (${name})`)).toEqual([]);
  });

  it("proves every exclusion is REALLY claimed by the sector it names", () => {
    // THE assertion this file exists for — see the header. "Excluded because sector
    // X owns it" is a CLAIM, and it must be checked against that sector's own MEMBER
    // list, never against the EIK appearing somewhere in its file: an
    // ADJACENT-BUT-EXCLUDED block mentions an EIK precisely in order to DISCLAIM it,
    // so a grep finds it either way and reads the same both times.
    const claims = new Map<string, string[]>();
    for (const [id, c] of Object.entries(SECTOR_DASHBOARDS))
      for (const m of c.members)
        claims.set(m.eik, [...(claims.get(m.eik) ?? []), id]);
    for (const p of Object.values(SECTOR_BROWSE_PACKS))
      for (const e of p.eiks) claims.set(e, [...(claims.get(e) ?? []), p.id]);

    // Non-vacuity: an emptied AGRI_EXTERNAL_BODIES would pass the filter below.
    expect(AGRI_EXTERNAL_BODIES.length).toBeGreaterThanOrEqual(3);
    const unowned = AGRI_EXTERNAL_BODIES.filter(
      (e) => !(claims.get(e.eik) ?? []).includes(e.sector),
    ).map(
      (e) =>
        `${e.eik} (${e.name}) excluded to "${e.sector}", owners: ${(claims.get(e.eik) ?? ["NONE"]).join(", ")}`,
    );
    expect(unowned).toEqual([]);
  });

  it("claims no EIK another sector already owns", () => {
    // The converse direction: this roster must not annex a body from a sector that
    // lists it. The cross-sector gate in sector_stats.data.test.ts covers the whole
    // registry; this one fails locally, without Postgres, naming agri.
    const others = new Map<string, string[]>();
    for (const [id, c] of Object.entries(SECTOR_DASHBOARDS)) {
      if (id === "agri") continue;
      for (const m of c.members)
        others.set(m.eik, [...(others.get(m.eik) ?? []), id]);
    }
    const stolen = AGRI_SECTOR_EIKS.filter((e) => others.has(e)).map(
      (e) => `${e} also in ${(others.get(e) ?? []).join(", ")}`,
    );
    expect(stolen).toEqual([]);
  });
});

describe("the footnote", () => {
  it("derives its counts instead of hard-coding them", () => {
    // RegionalPack's bg line said 28 and its en line 27 for the same set. Both
    // languages must therefore carry the SAME derived numbers.
    const parks = AGRI_ENTITIES.filter(
      (e) => e.universe === "nature_park",
    ).length;
    const odbh = AGRI_ENTITIES.filter(
      (e) => e.universe === "regional_odbh",
    ).length;
    for (const bg of [true, false]) {
      const s = agriFootnote(bg);
      expect(s).toContain(String(AGRI_BODY_COUNT));
      expect(s).toContain(String(parks));
      expect(s).toContain(String(odbh));
      // Every external body is NAMED, not just counted — a footnote saying "four"
      // and listing three is the drift this checks for.
      for (const e of AGRI_EXTERNAL_BODIES) expect(s).toContain(e.name);
    }
  });

  it("says the hub tile is a DIFFERENT basis", () => {
    // The whole reason /sector/agri contradicted its own tile. The bg line must
    // name the payout basis and deny that it adds to the procurement total.
    expect(agriFootnote(true)).toContain("ИЗПЛАТЕНОТО");
    expect(agriFootnote(false)).toContain("different basis");
  });
});
