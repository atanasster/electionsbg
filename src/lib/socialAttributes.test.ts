// `categoryOfCpv` and `CATEGORY_CPV_DIVS` are two statements of ONE rule: the first
// buckets a contract for the tile, the second builds the
// /procurement/contracts?cpv=… deep-link that tile's row links to. When they
// disagree the tile says „Материална помощ · €59M" and the link beneath opens a
// different set of contracts — both pages right, one of them about something else.
// Nothing else in the repo holds them together (the same header environmentAttributes
// carries, for the same reason).
//
// The named cases below are the two the 2026-08-15 audit fixed, both of the same
// class: a category whose LABEL claimed something the CPV division does not mean.

import { describe, it, expect } from "vitest";
import {
  categoryOfCpv,
  categoryCpvDivs,
  categoryLabel,
  type SocialCategory,
} from "./socialAttributes";

const CATEGORIES: SocialCategory[] = [
  "material_aid",
  "it_systems",
  "social_services",
  "construction",
  "admin_services",
  "supplies",
  "other",
];

describe("categoryOfCpv", () => {
  // €59.0M — the group's single biggest line, and it used to sit in „Офис, печат и
  // материали". It is АСП buying canned meat, lentils and sugar for FEAD parcels.
  it("routes food (15) to material_aid, not to supplies", () => {
    expect(categoryOfCpv("15891400")).toBe("material_aid"); // консерви
    expect(categoryOfCpv("03212211")).not.toBe("material_aid"); // lentils as agri-produce
    expect(categoryOfCpv("30197630")).toBe("supplies"); // paper — genuinely office
  });

  // Telecom SERVICES beside telecom EQUIPMENT: БТК is the group's #3 supplier and
  // 71 of its 81 contracts are division 64, which used to land in the sink.
  it("routes telecom services (64) to it_systems, beside telecom equipment (32)", () => {
    expect(categoryOfCpv("64200000")).toBe("it_systems");
    expect(categoryOfCpv("32250000")).toBe("it_systems");
    expect(categoryOfCpv("72000000")).toBe("it_systems");
  });

  // CPV 79 is business services INCL. security and printing — it is not a
  // consultancy division, which is why the category is no longer named for one.
  it("routes security and print (79) to admin_services", () => {
    expect(categoryOfCpv("79713000")).toBe("admin_services"); // охрана
    expect(categoryOfCpv("79820000")).toBe("admin_services"); // печат
    expect(categoryOfCpv("79420000")).toBe("admin_services"); // управленски
    expect(categoryLabel("admin_services", "bg")).not.toMatch(/онсултант/);
    expect(categoryLabel("admin_services", "en")).not.toMatch(/onsultan/i);
  });

  it("sinks an unmapped division and a missing CPV to other", () => {
    expect(categoryOfCpv("33711720")).toBe("other"); // hygiene aid — see the header
    expect(categoryOfCpv(undefined)).toBe("other");
    expect(categoryOfCpv("")).toBe("other");
  });

  it("ignores whitespace inside a CPV code", () => {
    expect(categoryOfCpv(" 158 914 00 ")).toBe("material_aid");
  });
});

describe("CATEGORY_CPV_DIVS mirrors categoryOfCpv", () => {
  it("routes every declared division back to its own category", () => {
    for (const cat of CATEGORIES)
      for (const div of categoryCpvDivs(cat))
        expect(categoryOfCpv(`${div}000000`), `${div} → ${cat}`).toBe(cat);
  });

  it("declares no division twice", () => {
    const all = CATEGORIES.flatMap((c) => categoryCpvDivs(c));
    expect(new Set(all).size).toBe(all.length);
  });

  // The reverse sweep: any division the classifier claims must be declared, or the
  // tile shows a bar whose deep-link cannot reproduce it.
  it("declares every division the classifier claims", () => {
    for (let d = 0; d < 100; d++) {
      const div = String(d).padStart(2, "0");
      const cat = categoryOfCpv(`${div}000000`);
      if (cat === "other") continue;
      expect(categoryCpvDivs(cat), `division ${div} → ${cat}`).toContain(div);
    }
  });

  it("gives the sink no divisions (it is not deep-linkable)", () => {
    expect(categoryCpvDivs("other")).toEqual([]);
  });
});

describe("categoryLabel", () => {
  it("labels every category in both languages", () => {
    for (const c of CATEGORIES) {
      expect(categoryLabel(c, "bg"), c).toBeTruthy();
      expect(categoryLabel(c, "en"), c).toBeTruthy();
      expect(categoryLabel(c, "bg")).not.toBe(c);
    }
  });

  it("falls back to the EN label for a non-bg language", () => {
    expect(categoryLabel("material_aid", "de")).toBe(
      categoryLabel("material_aid", "en"),
    );
  });
});
