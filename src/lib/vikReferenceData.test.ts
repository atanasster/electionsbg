// Structural gates for the curated water-sector allowlist.
//
// This list is hand-maintained and it is SUMMED — it drives the
// /governance/sectors water headline, the sector browse pack, /water,
// /water/operators and the operator map. So the failure modes it can produce are
// silent by construction: a duplicated EIK double-counts money at a 200, a
// missing oblast reads as "nobody supplies water there", and a `type` edit moves
// what /awarder/206086428 attributes to a named legal entity.
//
// Everything here is pure TypeScript ON PURPOSE. The audit's other gates live in
// scripts/db/tests/sector_stats.data.test.ts, which is PG-gated and auto-skips
// when Postgres is down — so on a fresh clone or a database-less CI leg those
// invariants are unguarded and these are not.
//
// Written after the 2026-08-13 sector audit (docs/plans/water-sector-audit-v1.md),
// which found seven missing operators worth €73.7M — three of them whole oblasti
// with no regional operator at all.

import { describe, it, expect } from "vitest";
import {
  WATER_OPERATORS,
  WATER_SECTOR_EIKS,
  VIK_HOLDING_SUB_EIKS,
  VIK_HOLDING_EIK,
  SOFIYSKA_VODA_EIK,
  NAPOITELNI_EIK,
  USYA_EIK,
  operatorByEik,
} from "./vikReferenceData";

// The two oblasti the completeness rule deliberately exempts, and WHY — see the
// header of vikReferenceData.ts. Both are facts about the country, not gaps in
// the list, which is the whole reason they are named rather than skipped.
const NO_REGIONAL_OPERATOR: Record<string, string> = {
  // Served by the Софийска вода concession, never by a holding subsidiary.
  "София (столица)": "concession",
  // The regional company was liquidated and its services fragmented across
  // municipal operators; the oblast genuinely has no regional monopoly.
  Пазарджик: "fragmented after liquidation",
};

describe("WATER_OPERATORS — structural invariants", () => {
  it("has no duplicate EIK", () => {
    // OPERATOR_BY_EIK collapses a repeat silently (last row wins) while the
    // summed array would not, so a paste error would double-count rather than
    // fail. The file documents two one-company-two-EIK cases, which is exactly
    // where that mistake lands.
    const eiks = WATER_OPERATORS.map((o) => o.eik);
    expect(new Set(eiks).size).toBe(eiks.length);
    expect(WATER_SECTOR_EIKS).toHaveLength(eiks.length);
  });

  it("every EIK is a well-formed 9- or 13-digit ЕИК", () => {
    for (const o of WATER_OPERATORS)
      expect(o.eik, `${o.name} (${o.eik})`).toMatch(/^\d{9}(\d{4})?$/);
  });

  it("has exactly one holding parent, one concession and one dams enterprise", () => {
    const count = (t: string) =>
      WATER_OPERATORS.filter((o) => o.type === t).length;
    expect(count("holding_parent")).toBe(1);
    expect(count("concession")).toBe(1);
    expect(count("dams")).toBe(1);
    expect(count("irrigation")).toBe(1);
  });

  it("names every operator and gives it an oblast", () => {
    for (const o of WATER_OPERATORS) {
      expect(o.name.trim(), o.eik).not.toBe("");
      expect(o.oblast.trim(), o.eik).not.toBe("");
    }
  });

  it("pins the sector population, so a stale prose count fails here", () => {
    // Four comments across three files used to restate these by hand and all
    // four went stale at once. Bands, not equality — the list grows.
    expect(WATER_SECTOR_EIKS.length).toBeGreaterThanOrEqual(45);
    expect(WATER_SECTOR_EIKS.length).toBeLessThan(80);
    expect(VIK_HOLDING_SUB_EIKS.length).toBeGreaterThanOrEqual(27);
  });
});

describe("the holding group vs the sector — the two must not converge", () => {
  it("VIK_HOLDING_SUB_EIKS is a STRICT subset of WATER_SECTOR_EIKS", () => {
    const sector = new Set(WATER_SECTOR_EIKS);
    for (const e of VIK_HOLDING_SUB_EIKS)
      expect(sector.has(e), `${e} missing from the sector set`).toBe(true);
    expect(VIK_HOLDING_SUB_EIKS.length).toBeLessThan(WATER_SECTOR_EIKS.length);
  });

  it("excludes the concession, the irrigation and the dams enterprises from the holding", () => {
    // Софийска вода is a Veolia CONCESSION — the reference data says in capitals
    // it is never a subsidiary, and it is the largest water awarder in the
    // country, so letting it into the holding set is an €627.6M misattribution
    // on Български ВиК холдинг's own page.
    expect(VIK_HOLDING_SUB_EIKS).not.toContain(SOFIYSKA_VODA_EIK);
    expect(VIK_HOLDING_SUB_EIKS).not.toContain(NAPOITELNI_EIK);
    expect(VIK_HOLDING_SUB_EIKS).not.toContain(USYA_EIK);
    expect(VIK_HOLDING_SUB_EIKS).not.toContain(VIK_HOLDING_EIK);
  });

  it("keeps all four of those in the sector set", () => {
    for (const e of [
      VIK_HOLDING_EIK,
      SOFIYSKA_VODA_EIK,
      NAPOITELNI_EIK,
      USYA_EIK,
    ])
      expect(WATER_SECTOR_EIKS).toContain(e);
  });
});

describe("oblast completeness — the check that found the audit's three gaps", () => {
  const liveRegional = () =>
    WATER_OPERATORS.filter((o) => o.type === "holding_sub" && !o.status);

  it("gives every oblast a live regional operator, except the two named ones", () => {
    const covered = new Set(liveRegional().map((o) => o.oblast));
    const oblasti = new Set(
      WATER_OPERATORS.filter((o) => !o.national).map((o) => o.oblast),
    );
    for (const oblast of oblasti) {
      if (oblast in NO_REGIONAL_OPERATOR) continue;
      expect(
        covered.has(oblast),
        `${oblast} has no live regional operator — either one is missing from ` +
          `WATER_OPERATORS, or the oblast belongs in NO_REGIONAL_OPERATOR with ` +
          `a reason`,
      ).toBe(true);
    }
  });

  it("keeps the two exemptions honest — neither may quietly gain one", () => {
    // If an exempt oblast DOES acquire a live regional operator, the exemption
    // is stale and the comment explaining it has become false. That is a
    // failure worth having: it is how a fixed situation gets noticed.
    const covered = new Set(liveRegional().map((o) => o.oblast));
    for (const oblast of Object.keys(NO_REGIONAL_OPERATOR))
      expect(
        covered.has(oblast),
        `${oblast} now HAS a live regional operator — remove it from ` +
          `NO_REGIONAL_OPERATOR and update the header`,
      ).toBe(false);
  });

  it("covers the three oblasti the 2026-08-13 audit found missing", () => {
    // Разград and Кюстендил had no regional operator at all; Пазарджик had only
    // a liquidated shell. Anchored on EIK, which is stable.
    expect(operatorByEik("826043778")?.oblast).toBe("Разград");
    expect(operatorByEik("200167154")?.oblast).toBe("Кюстендил");
    expect(operatorByEik("205323041")?.oblast).toBe("Пазарджик");
    for (const eik of ["826043778", "200167154", "205323041"])
      expect(WATER_SECTOR_EIKS).toContain(eik);
  });
});

describe("liveness is a field, never a display string", () => {
  it("marks the liquidated Пазарджик shell and points it at its successor", () => {
    // Its only marker used to be „(в ликвидация)" inside the Bulgarian label,
    // and a gate that regexes a display name is not a gate.
    const dead = operatorByEik("822106665");
    expect(dead?.status).toBe("liquidated");
    expect(dead?.successorEik).toBe("205323041");
    // The successor must be a real row, or the search box sends readers nowhere.
    expect(operatorByEik(dead!.successorEik!)).toBeDefined();
  });

  it("resolves every successorEik to a row in the list", () => {
    for (const o of WATER_OPERATORS) {
      if (!o.successorEik) continue;
      expect(
        operatorByEik(o.successorEik),
        `${o.eik} → ${o.successorEik}`,
      ).toBeDefined();
      // A successor that is itself dead would be a redirect into a dead end —
      // the person_slug_retired chain-collapse rule, applied here.
      expect(operatorByEik(o.successorEik)?.status).toBeUndefined();
    }
  });

  it("never marks a national row as an oblast's coverage", () => {
    for (const o of WATER_OPERATORS.filter((x) => x.national))
      expect(o.type, `${o.name} is national`).not.toBe("holding_sub");
  });
});
