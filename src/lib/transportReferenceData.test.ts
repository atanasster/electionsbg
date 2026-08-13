// Structural gates for the curated transport-sector allowlist.
//
// This list is hand-maintained and it is SUMMED — it drives the /governance/sectors
// transport headline, the sector browse pack, /sector/transport (KPI, mode split,
// competition heatmap, facility map) and the awarder-group-model endpoint. So the
// failure modes it can produce are silent by construction: a duplicated EIK
// double-counts money at a 200, a wrong `universe` moves a body's spend onto another
// mode's bar, and a member quietly dropped shrinks a mode without anything failing.
//
// Everything here is pure TypeScript ON PURPOSE. The audit's other gates live in
// scripts/db/tests/sector_stats.data.test.ts, which is PG-gated and auto-skips when
// Postgres is down — so on a fresh clone or a database-less CI leg those invariants are
// unguarded and these are not.
//
// ⚠ Transport is MORE exposed to the duplicate case than water, not less, and the
// difference is mechanical: WATER_SECTOR_EIKS is built as [...new Set(...)] and is
// deduped by construction, while TRANSPORT_SECTOR_EIKS is a plain .map over the entity
// rows. scripts/db/gen_procurement/sector_stats.ts then flattens it into unnest() join
// pairs with no dedupe of its own, so a repeated EIK matches every one of its contracts
// TWICE and over-states the hub headline — while ENTITY_BY_EIK (Object.fromEntries)
// collapses the duplicate silently, so transportEntityByEik keeps looking correct. The
// facility loader would eventually raise on its PRIMARY KEY, but only at a later
// db:refresh step, after the money artifact has already been written wrong.
//
// Written after the 2026-08-13 sector audit (docs/plans/transport-sector-audit-v1.md),
// which found four missing МТС bodies worth €374.3M — including БУЛАТСА, whose absence
// left the declared "aviation" universe reporting €3.7M against a real €348.2M.

import { describe, it, expect } from "vitest";
import {
  TRANSPORT_ENTITIES,
  TRANSPORT_SECTOR_EIKS,
  TRANSPORT_ALIAS_EIKS,
  TRANSPORT_UNIVERSES,
  TRANSPORT_UNIVERSE_LABEL,
  TRANSPORT_EIK,
  transportEntityByEik,
  transportUniverseOf,
} from "./transportReferenceData";

// The header's "EXPLICITLY OUT" block, as data. Each was measured and rejected in the
// audit; re-adding one is a decision, never a paste.
const ANTI_ALLOWLIST: { eik: string; what: string }[] = [
  { eik: "000632256", what: "Метрополитен ЕАД — municipal (Столична община)" },
  { eik: "121396123", what: "Български пощи — the „съобщения“ half of МТС" },
  { eik: "131516795", what: "ИАЕСМИС — the „съобщения“ half of МТС" },
  { eik: "103061301", what: "Пристанище Варна ЕАД — port OPERATOR, not infrastructure" }, // prettier-ignore
  { eik: "117021078", what: "Пристанищен комплекс Русе ЕАД — port OPERATOR" },
  { eik: "102004532", what: "Пристанище Бургас ЕАД — port OPERATOR" },
  {
    eik: "000662655",
    what: "НМТБ „Цар Борис III“ — buys medicines (ВМА distortion)",
  },
  { eik: "115214445", what: "МТБ Пловдив — buys medicines (ВМА distortion)" },
  { eik: "121747864", what: "КРС — reports to Народното събрание, not МТС" },
  {
    eik: "129009105",
    what: "Държавен авиационен оператор — към Министерски съвет",
  },
  { eik: "000695089", what: "АПИ — the separate /sector/roads" },
  {
    eik: "831646048",
    what: "„Автомагистрали“ ЕАД — the separate /sector/roads",
  },
];

// The four bodies the 2026-08-13 audit added. Pinned by EIK so a later edit that drops
// one has to delete a named line rather than shrink an array.
const AUDIT_ADDITIONS: { eik: string; universe: string; what: string }[] = [
  { eik: "000697179", universe: "aviation", what: "БУЛАТСА (ДП РВД)" },
  { eik: "121023551", universe: "aviation", what: "„Летище София“ ЕАД" },
  { eik: "000513106", universe: "maritime", what: "ИАППД" },
  { eik: "130847116", universe: "rail", what: "ДП ТСВ" },
];

describe("TRANSPORT_ENTITIES — structural invariants", () => {
  it("has no duplicate EIK", () => {
    const eiks = TRANSPORT_ENTITIES.map((e) => e.eik);
    const seen = new Set<string>();
    const dupes = eiks.filter((e) =>
      seen.has(e) ? true : (seen.add(e), false),
    );
    expect(dupes, `duplicated EIK(s): ${dupes.join(", ")}`).toEqual([]);
    expect(TRANSPORT_SECTOR_EIKS).toHaveLength(TRANSPORT_ENTITIES.length);
  });

  it("every EIK is a well-formed 9- or 13-digit ЕИК", () => {
    for (const e of TRANSPORT_ENTITIES)
      expect(e.eik, `${e.name} (${e.eik})`).toMatch(/^\d{9}(\d{4})?$/);
  });

  it("every entity carries a non-empty canonical name", () => {
    for (const e of TRANSPORT_ENTITIES)
      expect(e.name.trim(), `empty name for ${e.eik}`).not.toBe("");
  });

  it("names are distinct, so a chip set can't show one label twice", () => {
    const names = TRANSPORT_ENTITIES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("universes", () => {
  it("TRANSPORT_UNIVERSES covers every universe in use, exactly once", () => {
    expect(new Set(TRANSPORT_UNIVERSES).size).toBe(TRANSPORT_UNIVERSES.length);
    expect(new Set(TRANSPORT_UNIVERSES)).toEqual(
      new Set(TRANSPORT_ENTITIES.map((e) => e.universe)),
    );
  });

  it("every universe has a BG and an EN label", () => {
    for (const u of TRANSPORT_UNIVERSES) {
      expect(
        TRANSPORT_UNIVERSE_LABEL[u]?.bg,
        `no BG label for ${u}`,
      ).toBeTruthy();
      expect(
        TRANSPORT_UNIVERSE_LABEL[u]?.en,
        `no EN label for ${u}`,
      ).toBeTruthy();
    }
  });

  it("no mode is left with only the ministry — every non-ministry universe has a body", () => {
    // The defect this audit fixed was a DECLARED universe holding one token entity
    // (aviation = ГД ГВА alone), so the mode-split tile rendered a real mode as a
    // rounding error. A universe that exists must be populated to be honest.
    for (const u of TRANSPORT_UNIVERSES) {
      if (u === "ministry") continue;
      const n = TRANSPORT_ENTITIES.filter((e) => e.universe === u).length;
      expect(n, `universe "${u}" has ${n} entities`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("the lead ministry", () => {
  it("leads the list and is excluded from the alias set", () => {
    expect(TRANSPORT_ENTITIES[0].eik).toBe(TRANSPORT_EIK);
    expect(TRANSPORT_ENTITIES[0].universe).toBe("ministry");
    expect(TRANSPORT_ALIAS_EIKS).not.toContain(TRANSPORT_EIK);
    expect(TRANSPORT_ALIAS_EIKS).toHaveLength(TRANSPORT_ENTITIES.length - 1);
  });

  it("is the only ministry-universe entity", () => {
    expect(
      TRANSPORT_ENTITIES.filter((e) => e.universe === "ministry"),
    ).toHaveLength(1);
  });
});

describe("the curated boundary", () => {
  it("keeps every anti-allowlist EIK out", () => {
    for (const { eik, what } of ANTI_ALLOWLIST)
      expect(TRANSPORT_SECTOR_EIKS, `${eik} (${what}) is back in the set`).not.toContain(eik); // prettier-ignore
  });

  it("keeps the four bodies the 2026-08-13 audit added, on their audited universe", () => {
    for (const { eik, universe, what } of AUDIT_ADDITIONS) {
      expect(TRANSPORT_SECTOR_EIKS, `${what} (${eik}) was dropped`).toContain(
        eik,
      );
      expect(transportUniverseOf(eik), `${what} moved universe`).toBe(universe);
    }
  });
});

describe("lookup helpers", () => {
  it("resolve every member and nothing else", () => {
    for (const e of TRANSPORT_ENTITIES) {
      expect(transportEntityByEik(e.eik)).toEqual(e);
      expect(transportUniverseOf(e.eik)).toBe(e.universe);
    }
    expect(transportEntityByEik("000000000")).toBeUndefined();
    expect(transportUniverseOf("000000000")).toBeUndefined();
  });
});
