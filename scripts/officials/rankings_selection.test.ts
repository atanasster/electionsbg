// Which filing the officials leaderboard ranks on, and — just as important —
// which declarants stay IN the file at all.
//
// `data/officials/assets-rankings.json` is not only the /officials/assets
// leaderboard: `useOfficial` resolves an executive profile from it, and the
// sitemap enumerates it. So a declarant dropping out of it is a soft-404, not
// just a missing row. Both properties are asserted here because the fix for the
// first defect (rank on the newest ASSET-BEARING filing) came within one
// `continue` of causing the second.
//
// Pure functions over fixtures — `node` Vitest project, no network, no DB.

import { describe, expect, it } from "vitest";
import type { OfficialDeclaration } from "../../src/data/dataTypes";
import {
  latestAssetDeclaration,
  priorAssetDeclaration,
} from "../../src/lib/declarations";

const decl = (
  over: Partial<OfficialDeclaration> & { declarationYear: number },
): OfficialDeclaration =>
  ({
    slug: "test-official-abc123",
    declarantName: "Тест Тестов Тестов",
    institution: "Министерски съвет",
    positionTitle: null,
    fiscalYear: null,
    declarationType: "Annualy",
    filedAt: null,
    entryNumber: null,
    controlHash: null,
    sourceUrl: `https://register.cacbg.bg/${over.declarationYear}/x.xml`,
    ownershipStakes: [],
    income: [],
    assets: [],
    ...over,
  }) as OfficialDeclaration;

const cash = (eur: number): NonNullable<OfficialDeclaration["assets"]> => [
  {
    category: "cash",
    description: null,
    detail: null,
    location: null,
    municipality: null,
    areaSqm: null,
    builtAreaSqm: null,
    acquiredYear: null,
    share: null,
    currency: "BGN",
    amount: null,
    valueEur: eur,
    holderName: null,
    isSpouse: false,
    legalBasis: null,
    fundsOrigin: null,
  },
];

// Mirrors the generator: rank the newest asset-bearing filing, but fall back to
// the newest filing so the declarant keeps a row.
const selectForRanking = (decls: OfficialDeclaration[]) => {
  const withAssets = latestAssetDeclaration(decls);
  return {
    latest: withAssets ?? decls[0],
    prior: withAssets ? priorAssetDeclaration(decls, withAssets) : null,
    droppedFromRoster: decls.length === 0,
  };
};

describe("officials ranking selection", () => {
  it("ranks the asset-bearing filing when an incompatibility filing is newer", () => {
    // The 525-officials-at-€0 defect: the empty filing sorted first.
    const decls = [
      decl({ declarationYear: 2026, declarationType: "Other", assets: [] }),
      decl({
        declarationYear: 2024,
        fiscalYear: 2023,
        assets: cash(21555),
      }),
    ];
    const { latest } = selectForRanking(decls);
    expect(latest.declarationYear).toBe(2024);
    expect(latest.assets).toHaveLength(1);
  });

  it("keeps a declarant with no asset-bearing filing anywhere in the roster", () => {
    // 46 executive slugs look like this. Dropping them would take them out of
    // the file `useOfficial` and the sitemap both read.
    const decls = [
      decl({ declarationYear: 2023, declarationType: "Vacate", assets: [] }),
      decl({ declarationYear: 2023, fiscalYear: 2022, assets: [] }),
    ];
    const { latest, prior } = selectForRanking(decls);
    expect(latest).toBeDefined();
    expect(latest.declarationYear).toBe(2023);
    expect(prior).toBeNull();
  });

  it("compares against a prior filing from a different period, skipping empties", () => {
    const decls = [
      decl({ declarationYear: 2026, declarationType: "Other", assets: [] }),
      decl({ declarationYear: 2025, fiscalYear: 2024, assets: cash(100) }),
      decl({ declarationYear: 2024, fiscalYear: 2023, assets: [] }),
      decl({ declarationYear: 2023, fiscalYear: 2022, assets: cash(60) }),
    ];
    const { latest, prior } = selectForRanking(decls);
    expect(latest.fiscalYear).toBe(2024);
    expect(prior?.fiscalYear).toBe(2022);
  });

  it("offers no comparison when only one period declares assets", () => {
    const decls = [
      decl({ declarationYear: 2025, fiscalYear: 2024, assets: cash(100) }),
      decl({ declarationYear: 2025, fiscalYear: 2024, assets: cash(100) }),
    ];
    expect(selectForRanking(decls).prior).toBeNull();
  });
});
