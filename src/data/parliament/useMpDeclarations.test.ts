// The vocabulary reshape that maps the mp_declarations() PG JSON onto the MpDeclaration type
// (persons-pg-retirement-v1 T2.1b). Pins every rename so a route/type drift fails here rather
// than as a blank field on the candidate assets page.

import { describe, it, expect } from "vitest";
import { reshapeFiling, type RawFiling } from "./useMpDeclarations";

const raw: RawFiling = {
  declarantName: "Иван Иванов",
  institution: "52-ро Народно събрание",
  year: 2025, // → declarationYear
  fiscalYear: 2024,
  type: "Annualy", // → declarationType
  filedAt: "2025-05-14",
  entryNumber: "Вх-123",
  controlHash: "abc",
  sourceUrl: "https://example/decl/1",
  stakes: [
    {
      tableNum: "11", // → table
      companyName: "АКМЕ ЕООД",
      companySlug: "akme-eood",
      holderName: "съпруга",
      transfereeName: "Петър Петров",
      shareSize: "100%",
      valueEur: 5000,
      registeredOffice: "София",
    },
  ],
  income: [
    {
      parent: "I. Доход",
      category: "Заплата",
      eurDeclarant: 30000,
      eurSpouse: 12000,
    },
  ],
  assets: [
    {
      category: "real_estate",
      tableNum: "1",
      description: "Апартамент",
      detail: null,
      location: "София",
      municipality: "Столична",
      areaSqm: 80,
      builtAreaSqm: 80,
      acquiredYear: 2010,
      share: "1/2",
      currency: "BGN",
      amount: 100000,
      valueEur: 51129,
      valueBasis: null,
      holderName: null,
      isSpouse: false,
      legalBasis: "покупко-продажба",
      fundsOrigin: "спестявания",
    },
  ],
  events: [
    {
      kind: "disposal_property",
      description: "Нива",
      detail: null,
      location: "Пловдив",
      municipality: null,
      valueEur: 20000,
      legalBasis: "възмездно",
    },
  ],
};

describe("reshapeFiling", () => {
  const d = reshapeFiling(raw, 5100);

  it("renames the top-level keys and synthesizes mpId", () => {
    expect(d.mpId).toBe(5100);
    expect(d.declarationYear).toBe(2025); // year →
    expect(d.declarationType).toBe("Annualy"); // type →
    expect(d.fiscalYear).toBe(2024);
    expect(d.sourceUrl).toBe("https://example/decl/1");
  });

  it("renames stakes → ownershipStakes with tableNum → table, itemType null", () => {
    expect(d.ownershipStakes).toHaveLength(1);
    const s = d.ownershipStakes[0];
    expect(s.table).toBe("11");
    expect(s.itemType).toBeNull(); // no PG column
    expect(s.companyName).toBe("АКМЕ ЕООД");
    expect(s.companySlug).toBe("akme-eood");
    expect(s.transfereeName).toBe("Петър Петров");
    expect(s.valueEur).toBe(5000);
  });

  it("renames income eur* → amountEur*", () => {
    expect(d.income[0].amountEurDeclarant).toBe(30000);
    expect(d.income[0].amountEurSpouse).toBe(12000);
    expect(d.income[0].category).toBe("Заплата");
  });

  it("passes assets through verbatim (keys already match MpAsset)", () => {
    expect(d.assets).toEqual(raw.assets);
  });

  it("null-fills the event geometry mp_declarations omits", () => {
    const e = d.events?.[0];
    expect(e?.kind).toBe("disposal_property");
    expect(e?.valueEur).toBe(20000);
    expect(e?.areaSqm).toBeNull();
    expect(e?.builtAreaSqm).toBeNull();
    expect(e?.currency).toBeNull();
  });

  it("tolerates missing optional arrays", () => {
    const bare = reshapeFiling(
      {
        ...raw,
        stakes: undefined,
        income: undefined,
        assets: undefined,
        events: undefined,
      },
      1,
    );
    expect(bare.ownershipStakes).toEqual([]);
    expect(bare.income).toEqual([]);
    expect(bare.assets).toEqual([]);
    expect(bare.events).toEqual([]);
  });
});
