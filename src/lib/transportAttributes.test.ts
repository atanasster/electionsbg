// Mirror + fixture tests for the transport classifier (transport-hub-v1 A3, A4,
// D8, G2/G3, G9). The CPV codes are real corpus rows.

import { describe, it, expect } from "vitest";
import {
  categoryOfCpv,
  categoryCpvDivs,
  isMinistryRailCpv,
  reattributedModes,
  isPsoAward,
  passThroughOf,
  operatingInputOf,
  isLoanRow,
  isMinistryMaritimeCpv,
  directShareKnown,
  type TransportCategory,
} from "./transportAttributes";
import { TRANSPORT_EIK } from "./transportReferenceData";

const CATS: TransportCategory[] = [
  "rolling_stock",
  "construction",
  "transport_services",
  "signalling_it",
  "maintenance",
  "design",
  "fuel_energy",
  "supplies",
  "other",
];

describe("categoryOfCpv (A3)", () => {
  it("keeps vehicles as rolling stock", () => {
    expect(categoryOfCpv("34600000")).toBe("rolling_stock"); // Шкода / Stadler trains
    expect(categoryOfCpv("34144000")).toBe("rolling_stock"); // Tesmec rail machines
  });

  it("moves track material and ATC equipment out of rolling stock", () => {
    expect(categoryOfCpv("34946000")).toBe("supplies"); // sleepers / fastenings
    expect(categoryOfCpv("34962100")).toBe("signalling_it"); // Saab digital tower
    expect(categoryOfCpv("34942000")).toBe("signalling_it"); // signalling equipment
  });

  it("puts postal & telecom services (CPV 64) under signalling/IT, not transport services", () => {
    expect(categoryOfCpv("64200000")).toBe("signalling_it");
    expect(categoryOfCpv("60210000")).toBe("transport_services");
  });

  it("sends a missing CPV to the sink", () => {
    expect(categoryOfCpv("")).toBe("other");
    expect(categoryOfCpv(undefined)).toBe("other");
  });
});

describe("categoryCpvDivs — the deep-link mirror", () => {
  // Every code whose prefix a category links to must classify into that category:
  // otherwise the tile and the browse it links to show different worlds.
  const SAMPLE = [
    "34000000", "34100000", "34144000", "34600000", "34900000", "34940000",
    "34946000", "34942000", "34962100", "34990000", "45000000", "60210000", "63700000",
    "64200000", "72000000", "50000000", "71000000", "09100000", "44000000",
    "79000000",
  ]; // prettier-ignore

  it("each linked prefix classifies into its own category", () => {
    for (const cat of CATS)
      for (const p of categoryCpvDivs(cat))
        for (const code of SAMPLE.filter((c) => c.startsWith(p)))
          expect(categoryOfCpv(code), `${code} via ${p}`).toBe(cat);
  });

  it("covers every sample code that is not in the sink", () => {
    for (const code of SAMPLE) {
      const cat = categoryOfCpv(code);
      if (cat === "other") continue;
      expect(
        categoryCpvDivs(cat).some((p) => code.startsWith(p)),
        `${code} (${cat}) is unreachable from its tile's link`,
      ).toBe(true);
    }
  });

  it("never links rolling stock to the carved-out 3494 / 3496", () => {
    const rs = categoryCpvDivs("rolling_stock");
    expect(rs.some((p) => "34946000".startsWith(p))).toBe(false);
    expect(rs.some((p) => "34962100".startsWith(p))).toBe(false);
    expect(categoryCpvDivs("other")).toEqual([]);
  });
});

describe("rail re-attribution (D8)", () => {
  it("matches only the ministry's PSO and rolling-stock rows", () => {
    expect(isMinistryRailCpv(TRANSPORT_EIK, "60210000")).toBe(true);
    expect(isMinistryRailCpv(TRANSPORT_EIK, "34600000")).toBe(true);
    expect(isMinistryRailCpv(TRANSPORT_EIK, "45000000")).toBe(false);
    expect(isMinistryRailCpv("130823243", "60210000")).toBe(false);
  });

  it("moves the money between modes and keeps the total", () => {
    const modes = reattributedModes(
      [
        { eik: TRANSPORT_EIK, totalEur: 2_400 },
        { eik: "130823243", totalEur: 3_000 }, // НКЖИ (rail)
        { eik: "000697179", totalEur: 300 }, // БУЛАТСА (aviation)
      ],
      [
        { cpv: "60210000", totalEur: 1_400 },
        { cpv: "34600000", totalEur: 900 },
        { cpv: "45000000", totalEur: 100 },
      ],
    );
    const by = Object.fromEntries(modes.map((m) => [m.universe, m.eur]));
    expect(by.ministry).toBe(100);
    expect(by.rail).toBe(5_300);
    expect(modes.reduce((a, m) => a + m.eur, 0)).toBe(5_700);
  });
});

describe("PSO awards (G2/G3)", () => {
  it("keys on awarder + CPV, never on the method", () => {
    expect(isPsoAward(TRANSPORT_EIK, "60210000")).toBe(true);
    expect(isPsoAward(TRANSPORT_EIK, "34600000")).toBe(false);
    expect(isPsoAward("175405647", "60210000")).toBe(false);
  });
});

describe("passThroughOf — staff benefits only (G9, audit 2026-10-17 T6)", () => {
  it("catches НКЖИ's vouchers filed under CPV 98000000 by their title", () => {
    expect(
      passThroughOf({
        cpv: "98000000",
        title: "Доставка на ваучери за храна за служителите на ДП НКЖИ",
      }),
    ).toBe("staffBenefits");
  });

  it("counts food in kind and the pension top-up as staff benefits", () => {
    expect(passThroughOf({ cpv: "15890000", title: "Доставка на безплатна храна и/или добавки" })).toBe("staffBenefits"); // prettier-ignore
    expect(passThroughOf({ cpv: "22000000", title: "Избор на оператор за изработване и доставка на ваучери за безплатна храна" })).toBe("staffBenefits"); // prettier-ignore
    expect(passThroughOf({ cpv: "66520000", title: "Допълнително доброволно пенсионно осигуряване" })).toBe("staffBenefits"); // prettier-ignore
  });

  it("does NOT call fuel, electricity or insurance pass-through — they are operating inputs", () => {
    for (const cpv of ["09134100", "09310000", "66510000", "65300000"])
      expect(passThroughOf({ cpv, title: "x" }), cpv).toBeNull();
  });

  it("does not read a bare „талон“ as a voucher (ИААА inspection coupons, parking)", () => {
    expect(passThroughOf({ cpv: "79800000", title: "Отпечатване на документи и контролни талони" })).toBeNull(); // prettier-ignore
    expect(passThroughOf({ cpv: "79800000", title: "Печат на талони за паркиране" })).toBeNull(); // prettier-ignore
    expect(passThroughOf({ cpv: "79800000", title: "Доставка на талони за храна" })).toBe("staffBenefits"); // prettier-ignore
  });

  it("leaves real procurement alone", () => {
    expect(passThroughOf({ cpv: "45234100", title: "Рехабилитация на жп участък" })).toBeNull(); // prettier-ignore
  });
});

describe("operatingInputOf (T6)", () => {
  it("types fuel, electricity and insurance, with the added recall", () => {
    expect(operatingInputOf({ cpv: "09134100", title: "дизелово гориво" })).toBe("fuel"); // prettier-ignore
    expect(operatingInputOf({ cpv: "09310000", title: "ел. енергия" })).toBe("electricity"); // prettier-ignore
    // Grid access and transmission is electricity too (CPV 653*).
    expect(operatingInputOf({ cpv: "65300000", title: "Достъп и пренос на електрическа енергия" })).toBe("electricity"); // prettier-ignore
    expect(operatingInputOf({ cpv: "66510000", title: "застраховки" })).toBe("insurance"); // prettier-ignore
    // The whole 66 insurance family, not just 665*.
    expect(operatingInputOf({ cpv: "66000000", title: "Групова застраховка „Живот“" })).toBe("insurance"); // prettier-ignore
  });

  it("leaves credit, consulting and staff benefits out", () => {
    expect(operatingInputOf({ cpv: "66113000", title: "Договор за паричен заем" })).toBeNull(); // prettier-ignore
    expect(operatingInputOf({ cpv: "66170000", title: "Договор за консултантски услуги" })).toBeNull(); // prettier-ignore
    expect(operatingInputOf({ cpv: "66520000", title: "пенсионно осигуряване" })).toBeNull(); // prettier-ignore
    // Banking, fund management and treasury are not insurance (FINDING-005).
    expect(operatingInputOf({ cpv: "66100000", title: "банкови услуги" })).toBeNull(); // prettier-ignore
    expect(operatingInputOf({ cpv: "66140000", title: "управление на портфейл" })).toBeNull(); // prettier-ignore
    expect(operatingInputOf({ cpv: "66600000", title: "трезорни услуги" })).toBeNull(); // prettier-ignore
  });
});

describe("isLoanRow (T8)", () => {
  it("reads the Eurofima loan and intra-group credit, not a purchase", () => {
    expect(isLoanRow("Договор за паричен заем", "66113000")).toBe(true);
    expect(isLoanRow("Договор за паричен заем с EUROFIMA", null)).toBe(true);
    expect(isLoanRow("Договор за кредит", "66000000")).toBe(true);
    expect(isLoanRow("Доставка на кредитни карти", "30000000")).toBe(false);
    expect(isLoanRow("Акредитиране на лаборатория", "79000000")).toBe(false);
  });
});

describe("isMinistryMaritimeCpv (T9)", () => {
  it("moves the ministry's dredging and boats, nothing else", () => {
    expect(isMinistryMaritimeCpv(TRANSPORT_EIK, "45247100")).toBe(true);
    expect(isMinistryMaritimeCpv(TRANSPORT_EIK, "34513550")).toBe(true);
    expect(isMinistryMaritimeCpv(TRANSPORT_EIK, "72000000")).toBe(false);
    expect(isMinistryMaritimeCpv("130316140", "45247100")).toBe(false);
  });

  it("re-attributes them to maritime with Σ unchanged", () => {
    const modes = reattributedModes(
      [{ eik: TRANSPORT_EIK, totalEur: 100 }],
      [
        { cpv: "45247100", totalEur: 30 },
        { cpv: "72000000", totalEur: 70 },
      ],
    );
    const by = Object.fromEntries(modes.map((m) => [m.universe, m.eur]));
    expect(by.maritime).toBe(30);
    expect(by.ministry).toBe(70);
    expect(modes.reduce((a, m) => a + m.eur, 0)).toBe(100);
  });
});

describe("directShareKnown (A4)", () => {
  it("divides by method-KNOWN € and reports the rest as coverage", () => {
    const r = directShareKnown([
      { method: "open", totalEur: 70 },
      { method: "limited", totalEur: 20 },
      { method: null, totalEur: 10 },
    ]);
    expect(r).toEqual({ directEur: 20, knownEur: 90, totalEur: 100 });
  });
});
