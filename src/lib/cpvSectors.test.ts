import { describe, it, expect } from "vitest";
import { groupMethodFacet, procedureBucket } from "./cpvSectors";

describe("groupMethodFacet", () => {
  it("merges the АОП BG phrase and the ЦАИС ЕОП enum for the same procedure", () => {
    const out = groupMethodFacet([
      { value: "Открита процедура", count: 3082 },
      { value: "open", count: 196 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].bucket).toBe("open");
    expect(out[0].count).toBe(3082 + 196);
    // both raw strings preserved so the "in" filter can send them
    expect(out[0].methods.sort()).toEqual(["open", "Открита процедура"].sort());
  });

  it("sums counts across distinct buckets and orders by count desc", () => {
    const out = groupMethodFacet([
      { value: "Пряко възлагане", count: 15 },
      { value: "Открита процедура", count: 3082 },
      { value: "Публично състезание", count: 318 },
      { value: "limited", count: 9 }, // → direct bucket, folds with пряко
    ]);
    // open (3082), competition (318), direct (15 + 9)
    expect(out.map((r) => r.bucket)).toEqual(["open", "competition", "direct"]);
    const direct = out.find((r) => r.bucket === "direct");
    expect(direct?.count).toBe(15 + 9);
    expect(direct?.methods.sort()).toEqual(
      ["limited", "Пряко възлагане"].sort(),
    );
  });

  it("routes unknown/empty method strings to the unknown bucket", () => {
    expect(procedureBucket("")).toBe("unknown");
    const out = groupMethodFacet([{ value: "", count: 4 }]);
    expect(out).toEqual([{ bucket: "unknown", count: 4, methods: [""] }]);
  });

  it("returns an empty array for no rows", () => {
    expect(groupMethodFacet([])).toEqual([]);
  });
});

describe("procedureBucket — tenders procedure_type vocabulary", () => {
  // The tenders corpus (procedure_type) carries phrasings the contracts
  // procurement_method matcher didn't cover; these previously fell to "other".
  const cases: [string, string][] = [
    ["Открита процедура", "open"],
    ["открита", "open"],
    ["Публично състезание", "competition"],
    ["Събиране на оферти с обява", "collection"],
    ["Договаряне без предварително обявление", "direct"],
    ["Пряко договаряне", "direct"],
    ["Договаряне без предварителна покана за участие", "direct"],
    ["Договаряне с предварителна покана за участие", "competition"],
    ["Договаряне с публикуване на обявление за поръчка", "competition"],
    ["Покана до определени лица", "competition"],
    ["Ограничена процедура", "competition"],
    ["Ограничена процедура по ДСП", "competition"],
    ["състезателна процедура с договаряне", "competition"],
    ["състезателен диалог", "competition"],
    ["Партньорство за иновации", "competition"],
    ["Динамична система за покупки", "framework"],
    ["Квалификационна система", "framework"],
    ["неопределен", "unknown"],
  ];
  it.each(cases)("maps %s → %s", (value, bucket) => {
    expect(procedureBucket(value)).toBe(bucket);
  });

  it("still routes the legacy НВМОП ordinance to other (no procedure grain)", () => {
    expect(procedureBucket("НВМОП")).toBe("other");
  });
});
