// Which filing answers "what is this person worth?" — the selector four
// consumers used to get wrong by taking declarations[0].

import { describe, expect, it } from "vitest";
import type { MpAsset } from "@/data/dataTypes";
import {
  byRecency,
  declarationTotals,
  hasDeclaredAssets,
  hasDeclaredIncome,
  hasDeclaredStakes,
  latestAssetDeclaration,
  latestDeclarationWith,
  priorAssetDeclaration,
} from "./declarations";

const asset = (
  category: MpAsset["category"],
  valueEur: number | null,
): MpAsset => ({
  category,
  description: null,
  detail: null,
  location: null,
  municipality: null,
  areaSqm: null,
  builtAreaSqm: null,
  acquiredYear: null,
  share: null,
  currency: null,
  amount: null,
  valueEur,
  holderName: null,
  isSpouse: false,
  legalBasis: null,
  fundsOrigin: null,
});

const decl = (
  declarationYear: number,
  fiscalYear: number | null,
  assets: MpAsset[] | undefined,
) => ({
  declarationYear,
  fiscalYear,
  assets,
  sourceUrl: `https://register.cacbg.bg/${declarationYear}/${fiscalYear}-${assets?.length ?? 0}.xml`,
});

describe("hasDeclaredAssets", () => {
  it("distinguishes a filing with an asset table from one without", () => {
    expect(hasDeclaredAssets(decl(2024, 2023, [asset("cash", 1)]))).toBe(true);
    expect(hasDeclaredAssets(decl(2024, null, []))).toBe(false);
    expect(hasDeclaredAssets(decl(2024, null, undefined))).toBe(false);
    expect(hasDeclaredAssets(undefined)).toBe(false);
  });
});

describe("latestAssetDeclaration", () => {
  it("skips a leading filing that declares no assets", () => {
    // Цоков's real shape: an incompatibility filing sits ahead of the annual
    // that actually carries his wealth.
    const decls = [
      decl(2023, null, []),
      decl(2024, 2023, [asset("real_estate", 21555)]),
    ];
    expect(latestAssetDeclaration(decls)?.declarationYear).toBe(2024);
  });

  it("skips a leading filing with an absent assets array", () => {
    const decls = [
      decl(2025, null, undefined),
      decl(2024, 2023, [asset("cash", 10)]),
    ];
    expect(latestAssetDeclaration(decls)?.declarationYear).toBe(2024);
  });

  it("returns the head when it does declare assets", () => {
    const decls = [
      decl(2025, 2024, [asset("bank", 5)]),
      decl(2024, 2023, [asset("bank", 4)]),
    ];
    expect(latestAssetDeclaration(decls)?.declarationYear).toBe(2025);
  });

  it("returns null when nothing in the history declares assets", () => {
    expect(latestAssetDeclaration([decl(2023, null, [])])).toBeNull();
    expect(latestAssetDeclaration([])).toBeNull();
  });

  // A debts-only filing is a real wealth statement (net worth is negative), so
  // it must not be skipped the way an empty one is.
  it("treats a debts-only filing as a wealth snapshot", () => {
    const decls = [decl(2025, 2024, [asset("debt", 15952)])];
    expect(latestAssetDeclaration(decls)?.declarationYear).toBe(2025);
  });
});

describe("priorAssetDeclaration", () => {
  it("skips a same-period filing so the delta is not a self-comparison", () => {
    // An annual and an exit declaration filed the same calendar year share a
    // declarationYear; only the fiscal year distinguishes them.
    const latest = decl(2024, 2023, [asset("cash", 100)]);
    const decls = [
      latest,
      decl(2024, 2023, [asset("cash", 100)]),
      decl(2023, 2022, [asset("cash", 60)]),
    ];
    expect(priorAssetDeclaration(decls, latest)?.fiscalYear).toBe(2022);
  });

  it("skips an asset-less filing when looking back", () => {
    const latest = decl(2025, 2024, [asset("cash", 100)]);
    const decls = [
      latest,
      decl(2024, 2023, []),
      decl(2023, 2022, [asset("cash", 60)]),
    ];
    expect(priorAssetDeclaration(decls, latest)?.fiscalYear).toBe(2022);
  });

  it("returns null when there is nothing to compare against", () => {
    const latest = decl(2025, 2024, [asset("cash", 100)]);
    expect(priorAssetDeclaration([latest], latest)).toBeNull();
    expect(priorAssetDeclaration([], null)).toBeNull();
  });
});

describe("byRecency — filings sharing a date", () => {
  const filing = (
    declarationType: string,
    entryNumber: string,
  ): import("./declarations").DeclarationLike => ({
    declarationYear: 2024,
    fiscalYear: null,
    filedAt: "2024-05-02",
    entryNumber,
    declarationType,
    sourceUrl: `https://register.cacbg.bg/2024/${entryNumber}.xml`,
  });

  // Ивелина Дундакова: exit filing (9 rows, +52,270 EUR) vs an annual filed the
  // same day (3 rows, −79,546 EUR). The entry-number prefix is the FORM, so
  // "Г6706" sorting before "Ф576" published the wrong headline for 100 people.
  it("puts an exit declaration ahead of an annual filed the same day", () => {
    const annual = filing("Annualy", "Г6706");
    const vacate = filing("Vacate", "Ф576");
    expect([annual, vacate].sort(byRecency)[0]).toBe(vacate);
    expect([vacate, annual].sort(byRecency)[0]).toBe(vacate);
  });

  it("puts an entry declaration last among same-day filings", () => {
    const entry = filing("Entry", "Ф100");
    const annual = filing("Annualy", "Г100");
    expect([entry, annual].sort(byRecency)[0]).toBe(annual);
  });

  it("still orders by year and date before type", () => {
    const oldVacate = { ...filing("Vacate", "Ф1"), declarationYear: 2023 };
    const newAnnual = filing("Annualy", "Г1");
    expect([oldVacate, newAnnual].sort(byRecency)[0]).toBe(newAnnual);
  });

  it("falls back to entry number then sourceUrl when the type ties too", () => {
    const a = filing("Annualy", "Г100");
    const b = filing("Annualy", "Г200");
    expect([b, a].sort(byRecency)[0]).toBe(a);
  });
});

describe("declarationTotals", () => {
  it("nets debts off the summed asset categories", () => {
    const t = declarationTotals([
      asset("real_estate", 600),
      asset("bank", 27),
      asset("debt", 332),
    ]);
    expect(t.assetsEur).toBe(627);
    expect(t.debtsEur).toBe(332);
    expect(t.netEur).toBe(295);
  });

  it("counts unvalued real estate, which otherwise silently reads as €0", () => {
    const t = declarationTotals([
      asset("real_estate", null),
      asset("real_estate", 100),
    ]);
    expect(t.realEstateUnvalued).toBe(1);
    expect(t.assetsEur).toBe(100);
  });

  it("returns zeroes for an absent asset list", () => {
    expect(declarationTotals(undefined)).toEqual({
      assetsEur: 0,
      debtsEur: 0,
      netEur: 0,
      realEstateUnvalued: 0,
    });
  });
});

describe("latestDeclarationWith — per-section filings", () => {
  const income = (eur: number | null) => ({
    parent: null,
    category: "Годишна данъчна основа от трудови доходи",
    amountEurDeclarant: eur,
    amountEurSpouse: null,
  });
  const stake = (companyName: string) => ({
    table: "10" as const,
    itemType: null,
    shareSize: null,
    companyName,
    registeredOffice: null,
    valueEur: null,
    holderName: null,
    legalBasis: null,
    fundsOrigin: null,
  });

  // The filing kinds carry different tables, so a single "latest" cannot serve
  // the wealth, income and interests sections at once.
  it("resolves wealth, income and stakes to different filings", () => {
    const decls = [
      { ...decl(2025, null, undefined), ownershipStakes: [stake("АЛФА")] },
      decl(2024, 2023, [asset("cash", 5)]),
      { ...decl(2023, 2022, undefined), income: [income(44888)] },
    ];
    expect(latestAssetDeclaration(decls)?.declarationYear).toBe(2024);
    expect(
      latestDeclarationWith(decls, hasDeclaredIncome)?.declarationYear,
    ).toBe(2023);
    expect(
      latestDeclarationWith(decls, hasDeclaredStakes)?.declarationYear,
    ).toBe(2025);
  });

  it("ignores an income table whose every row is zero", () => {
    const decls = [{ ...decl(2025, 2024, undefined), income: [income(0)] }];
    expect(latestDeclarationWith(decls, hasDeclaredIncome)).toBeNull();
  });

  // Deliberate: a filing that declares only interests is an incompatibility
  // filing, and has no wealth statement to show even though the MP net-worth
  // basis values table-10 stakes.
  it("does not treat a stakes-only filing as a wealth snapshot", () => {
    const decls = [
      { ...decl(2025, null, undefined), ownershipStakes: [stake("АЛФА")] },
    ];
    expect(latestAssetDeclaration(decls)).toBeNull();
  });
});
