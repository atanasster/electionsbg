// Structural gates on the social sector's curated allowlist. These are the checks
// that CANNOT be made by looking at one file: every one of them is a pair of
// declarations that must agree, and each pair has already drifted somewhere in this
// codebase.
//
// The € / EIK-attribution gates need Postgres and live in the sector data tests
// under scripts/db/tests/. This file is pure and runs in the ordinary unit suite.

import { describe, it, expect } from "vitest";
import {
  SOCIAL_ENTITIES,
  SOCIAL_SECTOR_EIKS,
  SOCIAL_ALIAS_EIKS,
  SOCIAL_EIK,
  SOCIAL_UNIVERSES,
  SOCIAL_UNIVERSE_LABEL,
  socialGroupDetail,
  socialEntityByEik,
  socialUniverseOf,
} from "./socialReferenceData";

describe("SOCIAL_ENTITIES", () => {
  it("has no duplicate EIKs", () => {
    const eiks = SOCIAL_ENTITIES.map((e) => e.eik);
    expect(new Set(eiks).size).toBe(eiks.length);
  });

  it("carries only 9-or-13-digit EIK-shaped ids", () => {
    for (const e of SOCIAL_ENTITIES)
      expect(e.eik, `${e.name} has a malformed EIK`).toMatch(
        /^(\d{9}|\d{13})$/,
      );
  });

  it("keeps МТСП as the lead and excludes it from the alias list", () => {
    expect(SOCIAL_ENTITIES[0].eik).toBe(SOCIAL_EIK);
    expect(SOCIAL_ALIAS_EIKS).not.toContain(SOCIAL_EIK);
    expect(SOCIAL_ALIAS_EIKS.length).toBe(SOCIAL_ENTITIES.length - 1);
  });

  it("exports one EIK per entity, in order", () => {
    expect(SOCIAL_SECTOR_EIKS).toEqual(SOCIAL_ENTITIES.map((e) => e.eik));
  });

  // НОИ has its own /pensions view; the `social` hub slot used to point AT НОИ,
  // exactly duplicating `pension`, and folding it back in would restore that.
  it("keeps НОИ out (it is the /pensions view)", () => {
    expect(SOCIAL_SECTOR_EIKS).not.toContain("121082521");
  });

  // The top hit of a „социал" name sweep, and bigger than this entire group.
  it("keeps МВР's ДУССД out (the €309M name-sweep trap)", () => {
    expect(SOCIAL_SECTOR_EIKS).not.toContain("129010157");
  });

  it("resolves every member through the by-EIK lookups", () => {
    for (const e of SOCIAL_ENTITIES) {
      expect(socialEntityByEik(e.eik)?.name).toBe(e.name);
      expect(socialUniverseOf(e.eik)).toBe(e.universe);
    }
    expect(socialEntityByEik("000000000")).toBeUndefined();
    expect(socialUniverseOf("000000000")).toBeUndefined();
  });
});

describe("the universe union, the label map, the picker order and the entities agree", () => {
  it("gives every picker entry a label", () => {
    for (const u of SOCIAL_UNIVERSES)
      expect(SOCIAL_UNIVERSE_LABEL[u]?.bg, `no label for ${u}`).toBeTruthy();
  });

  // The gate that matters: a universe added to the type and to the label map but
  // missed in the picker order would type-check and simply never be selectable.
  it("offers every labelled universe in the picker", () => {
    expect([...SOCIAL_UNIVERSES].sort()).toEqual(
      Object.keys(SOCIAL_UNIVERSE_LABEL).sort(),
    );
  });

  it("has no universe that no entity occupies", () => {
    const used = new Set(SOCIAL_ENTITIES.map((e) => e.universe));
    for (const u of SOCIAL_UNIVERSES)
      expect(used.has(u), `universe "${u}" has no member`).toBe(true);
  });

  it("puts every entity's universe in the picker", () => {
    for (const e of SOCIAL_ENTITIES)
      expect(SOCIAL_UNIVERSES, `${e.name}`).toContain(e.universe);
  });
});

describe("socialGroupDetail", () => {
  // The footnote reads „по N структури … — <detail>". Typed by hand the two halves
  // desync (RegionalPack's bg line said 28 while its en line said 27), so the
  // clause is derived — and this asserts it stays derived.
  it("names exactly as many bodies as the allowlist holds, in both languages", () => {
    for (const lang of ["bg", "en"]) {
      const parts = socialGroupDetail(lang).split(", ");
      expect(parts.length, `${lang} detail`).toBe(SOCIAL_ENTITIES.length);
      expect(parts.every((p) => p.trim().length > 0)).toBe(true);
    }
  });

  it("names the two members added by the 2026-08-15 audit", () => {
    expect(socialGroupDetail("bg")).toContain("НИПА");
    expect(socialGroupDetail("bg")).toContain("ДАЗД");
  });

  it("falls back to the EN labels for any non-bg language", () => {
    expect(socialGroupDetail("en")).toContain("the Employment Agency");
    expect(socialGroupDetail("de")).toBe(socialGroupDetail("en"));
  });
});
