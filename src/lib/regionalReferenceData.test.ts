// The МРРБ governors roster was first curated by MEASURING `contracts.awarder_eik`,
// and that method can only find a governor which has already awarded something. So
// Областна администрация — област Търговище (zero contracts, to this day) was silently
// absent, and the dashboard asserted „27-те областни администрации" as a complete
// roster — in eight places including the indexed prerender description — beside a
// convergence tile on the same page counting 28 oblasti.
//
// Nothing enforced the roster's own thesis, so the next re-curation would reproduce
// the defect by exactly the same mechanism and be exactly as invisible. The bijection
// with the canonical oblast buckets is the gate: it fails BOTH when a governor is
// missing and when a stray code appears, which a count alone would not.

import { describe, expect, it } from "vitest";
import {
  REGIONAL_ENTITIES,
  REGIONAL_GOVERNOR_COUNT,
  REGIONAL_SECTOR_EIKS,
  REGIONAL_ALIAS_EIKS,
  REGIONAL_EIK,
} from "./regionalReferenceData";
import { OBLAST_NAME } from "./regionalOblast";

const governors = REGIONAL_ENTITIES.filter((e) => e.universe === "governors");

describe("REGIONAL_ENTITIES — the governors roster", () => {
  it("is a bijection with the canonical oblast buckets", () => {
    // ONE PER OBLAST, never "however many appear in the corpus". Asserting the
    // set rather than the count is what makes a missing governor and a stray
    // code both fail, and what ties the roster to the geography the choropleth
    // and the convergence scatter already use.
    const codes = governors.map((e) => e.oblastCode);
    expect(new Set(codes).size).toBe(codes.length); // no oblast twice
    expect([...codes].sort()).toEqual(Object.keys(OBLAST_NAME).sort());
  });

  it("keeps Търговище, the governor a corpus measurement cannot see", () => {
    // Pinned by EIK, not by name: this is the anti-regression for the actual
    // defect. It has zero contracts, so any future re-curation that measures
    // the corpus drops it again and lands here.
    const tgv = governors.find((e) => e.oblastCode === "TGV");
    expect(tgv?.eik).toBe("125043455");
  });

  it("gives an oblastCode to every governor and to nobody else", () => {
    expect(governors.filter((e) => !e.oblastCode)).toEqual([]);
    expect(
      REGIONAL_ENTITIES.filter(
        (e) => e.universe !== "governors" && e.oblastCode,
      ),
    ).toEqual([]);
  });

  it("derives REGIONAL_GOVERNOR_COUNT from the roster", () => {
    // The count is interpolated into user-facing prose in both languages. Typed
    // by hand it desynced — the Bulgarian half of two bilingual pairs was
    // updated to 28 and the English half stayed at 27, so the site stated two
    // roster sizes for one roster depending on the language.
    expect(REGIONAL_GOVERNOR_COUNT).toBe(governors.length);
    expect(REGIONAL_GOVERNOR_COUNT).toBe(Object.keys(OBLAST_NAME).length);
  });
});

describe("REGIONAL_ENTITIES — the EIK set", () => {
  it("has unique, well-formed EIKs", () => {
    const eiks = REGIONAL_ENTITIES.map((e) => e.eik);
    expect(new Set(eiks).size).toBe(eiks.length);
    for (const e of eiks) expect(e).toMatch(/^\d{9,13}$/);
  });

  it("exports the whole set, parent included, and the aliases without it", () => {
    expect([...REGIONAL_SECTOR_EIKS].sort()).toEqual(
      REGIONAL_ENTITIES.map((e) => e.eik).sort(),
    );
    expect(REGIONAL_SECTOR_EIKS).toContain(REGIONAL_EIK);
    expect(REGIONAL_ALIAS_EIKS).not.toContain(REGIONAL_EIK);
    expect(REGIONAL_ALIAS_EIKS.length).toBe(REGIONAL_SECTOR_EIKS.length - 1);
  });

  it("excludes АПИ and the ВиК holding — they are their own sectors", () => {
    // Folding either in would drown the sector and double-count against
    // /sector/roads and /water. АПИ alone is ~63× the whole МРРБ group.
    expect(REGIONAL_SECTOR_EIKS).not.toContain("000695089"); // АПИ
    expect(REGIONAL_SECTOR_EIKS).not.toContain("206086428"); // Български ВиК холдинг
  });

  it("marks a member with no awarder page, and only where it is true", () => {
    // The flag keeps a dead-end row out of the members search. Търговище is the
    // only member with a zero footprint in every corpus; the live half of this
    // (and what retires the flag) is sector_members_land.data.test.ts.
    expect(
      REGIONAL_ENTITIES.filter((e) => e.noAwarderPage).map((e) => e.eik),
    ).toEqual(["125043455"]);
  });
});
