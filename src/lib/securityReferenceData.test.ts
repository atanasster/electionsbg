// Invariants of the МВР roster and of the curated state-body list beside it.
// Six sibling reference-data files carry one of these; this one did not, and the
// 2026-08-19 audit found two omissions in the curated list that a test of its own
// stated bar would have surfaced.
//
//   npx vitest run src/lib/securityReferenceData.test.ts

import { describe, it, expect } from "vitest";
import {
  MVR_ENTITIES,
  SECURITY_SECTOR_EIKS,
  SECURITY_ALIAS_EIKS,
  SECURITY_STATE_BODY_CONTRACTORS,
  SECURITY_UNIVERSES,
  SECURITY_UNIVERSE_LABEL,
  MVR_EIK,
  MEDICAL_INSTITUTE_EIK,
  securityUniverseOf,
} from "./securityReferenceData";
import {
  categoryOfCpv,
  categoryCpvDivs,
  categoryLabel,
  type SecurityCategory,
} from "./securityAttributes";

describe("МВР roster", () => {
  it("has no duplicate EIK", () => {
    expect(new Set(SECURITY_SECTOR_EIKS).size).toBe(MVR_ENTITIES.length);
  });

  it("every EIK is a plain 9- or 13-digit Bulgarian id", () => {
    // Curated by EIK, so a typo is the failure mode — and a typo'd digit is still
    // a well-formed EIK, which is why the corpus-side gate exists too.
    for (const e of MVR_ENTITIES)
      expect(e.eik, e.name).toMatch(/^(\d{9}|\d{13})$/);
  });

  it("the alias set is the roster minus the ministry itself", () => {
    expect(SECURITY_ALIAS_EIKS).not.toContain(MVR_EIK);
    expect(new Set([MVR_EIK, ...SECURITY_ALIAS_EIKS])).toEqual(
      new Set(SECURITY_SECTOR_EIKS),
    );
  });

  it("every declared universe is populated and labelled", () => {
    // An empty universe is a dead Select option; an unlabelled one renders its id.
    for (const u of SECURITY_UNIVERSES) {
      expect(
        MVR_ENTITIES.some((e) => e.universe === u),
        u,
      ).toBe(true);
      expect(SECURITY_UNIVERSE_LABEL[u]?.bg, u).toBeTruthy();
      expect(SECURITY_UNIVERSE_LABEL[u]?.en, u).toBeTruthy();
    }
    // …and no entity sits in a universe the Select cannot offer.
    for (const e of MVR_ENTITIES)
      expect(SECURITY_UNIVERSES, e.name).toContain(e.universe);
  });

  it("the health confound is exactly one EIK", () => {
    // The „без Мед. институт" filter and the „От което Мед. институт" KPI both
    // assume this; a second health unit would make the KPI understate silently.
    const health = MVR_ENTITIES.filter((e) => e.universe === "health");
    expect(health.map((e) => e.eik)).toEqual([MEDICAL_INSTITUTE_EIK]);
    expect(securityUniverseOf(MEDICAL_INSTITUTE_EIK)).toBe("health");
  });
});

describe("curated state-body contractors", () => {
  it("holds no roster member", () => {
    // A member would be „в групата", which is the more specific statement — the
    // tile drops a row from `stateBodies` when it is also a member, so an overlap
    // is silently inert rather than wrong, and therefore worth asserting.
    for (const e of SECURITY_STATE_BODY_CONTRACTORS)
      expect(SECURITY_SECTOR_EIKS, e).not.toContain(e);
  });

  it("is plain EIKs, deduplicated", () => {
    expect(new Set(SECURITY_STATE_BODY_CONTRACTORS).size).toBe(
      SECURITY_STATE_BODY_CONTRACTORS.length,
    );
    for (const e of SECURITY_STATE_BODY_CONTRACTORS)
      expect(e).toMatch(/^(\d{9}|\d{13})$/);
  });

  it("carries the two additions the awarder probe cannot find", () => {
    // ⚠ THE REGRESSION THIS ARM EXISTS FOR. Neither Печатница на БНБ nor ТЕРЕМ is
    // a ЗОП contracting authority, so the „is this EIK an awarder somewhere" probe
    // returns neither while both are 100% state-owned — and both reach a displayed
    // top-8 rank (rank 3 and rank 8 at y:2018). Anyone re-deriving this list from
    // that probe would drop them, which is precisely what the docstring forbids.
    expect(SECURITY_STATE_BODY_CONTRACTORS).toContain("130800278"); // Печатница на БНБ
    expect(SECURITY_STATE_BODY_CONTRACTORS).toContain("103882821"); // ТЕРЕМ
  });
});

describe("CPV category mirror", () => {
  const CATEGORIES: SecurityCategory[] = [
    "vehicles",
    "fuel",
    "it_surveillance",
    "security_equip",
    "health",
    "construction",
    "supplies",
    "maintenance",
    "other",
  ];

  it("every CPV division routes to the category that claims it", () => {
    // `CATEGORY_CPV_DIVS` drives the deep-link („виж договорите" →
    // /procurement/contracts?cpv=…) while `categoryOfCpv` drives the tile's own
    // split. A drift sends the reader to a filtered browse over a different set
    // than the number they clicked — a wrong figure at a 200. Exhaustive over all
    // 100 divisions, both directions.
    for (let i = 0; i < 100; i++) {
      const div = String(i).padStart(2, "0");
      const cat = categoryOfCpv(`${div}000000`);
      for (const c of CATEGORIES) {
        const claims = categoryCpvDivs(c).includes(div);
        if (claims) expect(cat, `${div} claimed by ${c}`).toBe(c);
        if (cat === c && c !== "other")
          expect(claims, `${div} classified ${c} but unclaimed`).toBe(true);
      }
    }
  });

  it("`other` is the sink and is not deep-linkable", () => {
    expect(categoryCpvDivs("other")).toEqual([]);
    expect(categoryOfCpv("")).toBe("other");
    expect(categoryOfCpv(undefined)).toBe("other");
    expect(categoryOfCpv("99000000")).toBe("other");
  });

  it("a division set entry longer than two characters would be dead", () => {
    // The classifier slices to two characters, so `inDivisions` is exact equality.
    // This pins the semantics the old `startsWithAny` name obscured.
    expect(categoryOfCpv("32100000")).toBe("it_surveillance");
    expect(categoryOfCpv("32")).toBe("it_surveillance");
  });

  it("the health label names the CPV bucket, not one awarder", () => {
    // The row is CPV-33 across the whole group; naming the Медицински институт in
    // it put 9% (the institute's own spend) and 2% (everyone's medical spend)
    // under one name on the same page.
    for (const lang of ["bg", "en"]) {
      const label = categoryLabel("health", lang);
      expect(label).not.toMatch(/институт|Institute/i);
      expect(label).toBeTruthy();
    }
  });
});
