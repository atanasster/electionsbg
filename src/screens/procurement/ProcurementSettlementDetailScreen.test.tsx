// Phase 4a of the place-header consolidation: the procurement settlement page renders the
// shared PlaceHeaderView hero (title + composed breadcrumb + centroid) from the PG payload,
// with NO settlements.json and NO EKATTE chip. These test the pure hero builder — the title
// per language, the localized breadcrumb wording, the "област" strip, and loc parsing — which
// is the logic Phase 4a adds; the SQL half is pinned by the PG data gate.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { settlementHero, settlementSeo } from "./settlementHero";
import type { ProcurementBySettlementFile } from "@/data/dataTypes";

const varna = (over: Partial<ProcurementBySettlementFile> = {}) =>
  ({
    ekatte: "10135",
    name: "Варна",
    province: "Варна",
    obshtina: "Варна",
    nameEn: "Varna",
    settlementType: "гр.",
    loc: "27.910543,43.204665",
    obshtinaCode: "VAR06",
    obshtinaName: "Варна",
    obshtinaNameEn: "Varna",
    oblastCode: "VAR",
    oblastName: "Варна",
    oblastNameEn: "Varna",
    generatedAt: "",
    contractCount: 15073,
    awardCount: 0,
    totalEur: 3621757104,
    totalOther: {},
    awarders: [],
    topContracts: [],
    byYear: [],
    ...over,
  }) as ProcurementBySettlementFile;

const narrativeText = (node: React.ReactNode): string => {
  const { container } = render(<MemoryRouter>{node}</MemoryRouter>);
  return container.textContent ?? "";
};

describe("settlementHero", () => {
  it("BG: typed title + 'в община …, област …' breadcrumb + centroid", () => {
    const h = settlementHero(varna(), "bg");
    expect(h.titleText).toBe("гр. Варна");
    expect(h.loc).toEqual({ lat: 43.204665, lon: 27.910543 });
    const text = narrativeText(h.narrative);
    expect(text).toContain("в община");
    expect(text).toContain("Варна");
    expect(text).toContain("област");
  });

  it("EN: localized name + 'in … municipality, … oblast'", () => {
    const h = settlementHero(varna(), "en");
    // No т.в.м. prefix in English.
    expect(h.titleText).toBe("Varna");
    const text = narrativeText(h.narrative);
    expect(text).toContain("Varna");
    expect(text).toContain("municipality");
    expect(text).toContain("oblast");
  });

  it("strips the tautological 'област' suffix (Sofia province)", () => {
    const h = settlementHero(
      varna({
        name: "Своге",
        obshtinaName: "Своге",
        oblastCode: "SFO",
        oblastName: "Софийска област",
      }),
      "bg",
    );
    const text = narrativeText(h.narrative);
    // The narrative re-adds "област", so the raw name's suffix must be stripped first —
    // "област Софийска", never "област Софийска област".
    expect(text).toContain("област Софийска");
    expect(text).not.toContain("област Софийска област");
  });

  it("falls back to BG strings and drops the thumbnail when the dimension lacks a row", () => {
    // A settlement present in awarder_seats but not (yet) in place_dim: name/obshtina/oblast
    // come from the BG awarder_seats strings; nameEn/loc/codes are absent.
    const h = settlementHero(
      varna({
        nameEn: undefined,
        settlementType: undefined,
        loc: undefined,
        obshtinaCode: undefined,
        obshtinaNameEn: undefined,
        oblastCode: undefined,
        oblastNameEn: undefined,
      }),
      "bg",
    );
    expect(h.titleText).toBe("Варна");
    expect(h.loc).toBeNull();
  });
});

describe("settlementSeo", () => {
  it("BG: keeps the procurement framing + 'във' euphony before в/ф", () => {
    const seo = settlementSeo(varna(), "Варна", "bg");
    expect(seo.title).toBe("Обществени поръчки във Варна");
    expect(seo.description).toContain("във Варна");
    // Contract count, bg-BG grouped (the thousands separator is a non-breaking space).
    expect(seo.description).toMatch(/15.073.*договора/u);
  });

  it("BG: 'в' (not 'във') before other initials", () => {
    const seo = settlementSeo(varna({ name: "София" }), "София", "bg");
    expect(seo.title).toBe("Обществени поръчки в София");
  });

  it("EN: uses the localized displayName, procurement-framed", () => {
    const seo = settlementSeo(varna(), "Varna", "en");
    expect(seo.title).toBe("Public procurement in Varna");
    expect(seo.description).toContain("in Varna");
  });
});
