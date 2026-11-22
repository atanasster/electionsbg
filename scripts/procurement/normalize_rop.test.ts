import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildResolutionMaps,
  ropContentKeys,
  ropSupplierAgnosticKeys,
  buildTrNameMap,
  contractorLookupKeys,
  isSupplierList,
  isConsortiumName,
  normalizeRopRows,
  resolveViaTr,
  ropLegalForm,
  trLookupName,
  type ResolutionMaps,
  type RopRow,
} from "./normalize_rop";
import { nameOnlySupplierKey } from "./supplier_identity";
import { avoidExistingKeys } from "./contract_key";

const TR = buildTrNameMap([
  { uic: "203849571", name: "ПАВТРЕЙД", legal_form: "EOOD" },
  { uic: "200000001", name: "ПОЛЕТ 90", legal_form: "ET" },
  // Two registry companies fold to the same name — the tier must refuse.
  { uic: "300000001", name: "АЛФА", legal_form: "OOD" },
  { uic: "300000002", name: "АЛФА", legal_form: "OOD" },
  // A company sharing the words of a consortium's name.
  { uic: "400000001", name: "КРЕСНА 2016", legal_form: "EOOD" },
]);

const row = (contractorName: string, over: Partial<RopRow> = {}): RopRow => ({
  unp: "00165-2019-0017",
  publishedDate: "2020-01-17",
  awarderName: "Министерство на образованието и науката /МОН/",
  contractorName,
  contractNumber: "Д01-2",
  contractDate: "2020-01-14",
  subject: "Услуги",
  amount: 3175000,
  currency: "BGN",
  ...over,
});

const maps = (over: Partial<ResolutionMaps> = {}): ResolutionMaps => ({
  awarderByPrefix: new Map([["00165", "000695114"]]),
  awarderByName: new Map(),
  contractorByName: new Map(),
  trByName: TR,
  ...over,
});

describe("trLookupName / ropLegalForm", () => {
  it("strips the city suffix and one legal-form token, either side", () => {
    expect(trLookupName("Павтрейд ЕООД - София")).toBe("павтрейд");
    expect(trLookupName("ЕТ „Полет 90“")).toBe("полет 90");
  });
  it("reads the declared legal form, or nothing", () => {
    expect(ropLegalForm("Павтрейд ЕООД - София")).toBe("ЕООД");
    expect(ropLegalForm("ЕТ Полет 90")).toBe("ЕТ");
    expect(ropLegalForm("Алстом Транспорт С.А.")).toBeUndefined();
  });
});

describe("isConsortiumName", () => {
  it.each([
    "ДЗЗД Кресна 2016",
    "Консорциум ТРП-БУРГАС 2019",
    "Обединение Пътища",
    "Бул-Марк ООД - Варна,ДЗЗД Енергетика",
  ])("%s is a consortium", (n) => expect(isConsortiumName(n)).toBe(true));
  it("does not fire inside a word", () =>
    expect(isConsortiumName("Дзздстрой ООД")).toBe(false));
});

describe("resolveViaTr", () => {
  it("resolves a unique name whose legal form agrees", () =>
    expect(resolveViaTr("Павтрейд ЕООД - София", TR)).toBe("203849571"));
  it("refuses when the legal form disagrees", () =>
    expect(resolveViaTr("Павтрейд АД", TR)).toBe(""));
  it("refuses when the name declares no legal form", () =>
    expect(resolveViaTr("Павтрейд", TR)).toBe(""));
  it("refuses an ambiguous name", () =>
    expect(resolveViaTr("Алфа ООД", TR)).toBe(""));
  it("never looks up a consortium, even when the words match a company", () =>
    expect(resolveViaTr("ДЗЗД Кресна 2016", TR)).toBe(""));
  it("is off without a map", () =>
    expect(resolveViaTr("Павтрейд ЕООД", undefined)).toBe(""));
});

describe("normalizeRopRows — supplier tiers", () => {
  it("prefers the corpus map over the registry", () => {
    const { contracts, stats } = normalizeRopRows(
      [row("Павтрейд ЕООД - София")],
      maps({ contractorByName: new Map([["павтрейд еоод", "999999990"]]) }),
      "x",
    );
    expect(contracts[0].contractorEik).toBe("999999990");
    expect(stats.contractorViaTr).toBe(0);
  });

  it("falls back to the registry", () => {
    const { contracts, stats } = normalizeRopRows(
      [row("Павтрейд ЕООД - София")],
      maps(),
      "x",
    );
    expect(contracts[0].contractorEik).toBe("203849571");
    expect(stats.contractorViaTr).toBe(1);
  });

  it("keys an unresolvable supplier by name instead of dropping the row", () => {
    const name = "ДЗЗД ЩРАБАГ ДЖИ ПИ РЕЙЛ 2017";
    const { contracts, stats } = normalizeRopRows([row(name)], maps(), "x");
    expect(stats.droppedNoContractorEik).toBe(0);
    expect(stats.contractorNameKeyed).toBe(1);
    expect(contracts[0].contractorEik).toBe(nameOnlySupplierKey(name));
    expect(contracts[0].contractorEik).toMatch(/^nm-[0-9a-f]{12}$/);
    expect(contracts[0].contractorName).toMatch(/щрабаг/i);
  });

  it("still drops a row with no supplier name at all", () => {
    const { contracts, stats } = normalizeRopRows([row("  ")], maps(), "x");
    expect(contracts).toHaveLength(0);
    expect(stats.droppedNoContractorEik).toBe(1);
  });
});

describe("nameOnlySupplierKey", () => {
  it("is stable and case-insensitive, and fragments rather than merges", () => {
    expect(nameOnlySupplierKey("ДЗЗД Кресна 2016")).toBe(
      nameOnlySupplierKey("дззд   кресна 2016"),
    );
    // A city suffix is NOT stripped: one supplier may fragment, two never merge.
    expect(nameOnlySupplierKey("ДЗЗД Кресна 2016 - София")).not.toBe(
      nameOnlySupplierKey("ДЗЗД Кресна 2016"),
    );
    expect(nameOnlySupplierKey("")).toBe("");
  });
});

describe("multi-supplier lists", () => {
  const LIST =
    "Алта Фармасютикълс ЕООД - София,Булгермед ВЕ ООД - София,РОШ БЪЛГАРИЯ ЕООД";
  it("tells a list from one firm with its seat after a comma", () => {
    expect(isSupplierList(LIST)).toBe(true);
    expect(isSupplierList("Лабтех ЕООД, гр. Пловдив")).toBe(false);
  });
  it("never resolves a list to its first member", () => {
    expect(contractorLookupKeys(LIST)).toHaveLength(1);
    const { contracts, stats } = normalizeRopRows(
      [row(LIST)],
      maps({
        contractorByName: new Map([["алта фармасютикълс еоод", "175000001"]]),
      }),
      "x",
    );
    expect(contracts[0].contractorEik).not.toBe("175000001");
    expect(contracts[0].contractorEik).toMatch(/^nm-/);
    expect(stats.contractorNameKeyed).toBe(1);
  });
  it("still lets a single firm resolve through its first segment", () => {
    const { contracts } = normalizeRopRows(
      [row("Лабтех ЕООД, гр. Пловдив")],
      maps({ contractorByName: new Map([["лабтех еоод", "175000002"]]) }),
      "x",
    );
    expect(contracts[0].contractorEik).toBe("175000002");
  });
});

describe("avoidExistingKeys", () => {
  it("re-keys only the newcomer, so an existing /contract/:key URL never moves", () => {
    const rows = [
      { key: "aaa", d: "x" },
      { key: "bbb", d: "y" },
    ];
    const taken = new Set(["aaa"]);
    const { rekeyed, unresolved } = avoidExistingKeys(rows, taken, (r) => r.d);
    expect(rekeyed).toBe(1);
    expect(unresolved).toHaveLength(0);
    expect(rows[0].key).not.toBe("aaa");
    expect(rows[1].key).toBe("bbb");
    expect(taken.has("aaa") && taken.has(rows[0].key)).toBe(true);
  });
  it("returns a row its discriminator cannot separate", () => {
    const first = [{ key: "aaa", d: "x" }];
    const taken = new Set(["aaa"]);
    avoidExistingKeys(first, taken, (r) => r.d);
    const again = [{ key: "aaa", d: "x" }];
    expect(avoidExistingKeys(again, taken, (r) => r.d).unresolved).toEqual(
      again,
    );
  });
});

describe("ropContentKeys", () => {
  const base = {
    key: "k",
    ocid: "o",
    releaseId: "aop-legacy-2019-1",
    tag: "contract" as const,
    date: "2019-12-20",
    unp: "00165-2018-0009",
    awarderEik: "000695114",
    awarderName: "МОН",
    contractorEik: "103008874",
    contractorName: "Джеми ООД",
    amount: 3396600,
    currency: "BGN",
    amountEur: 1736649,
    title: "",
    bundleUuid: "rop-register",
    sourceUrl: "x",
  };
  const shared = (a: string[], b: string[]) => a.filter((k) => b.includes(k));

  it("does NOT match a repeat purchase at the same price (other number, other date)", () => {
    const first = { ...base, contractId: "Д01-328", dateSigned: "2019-12-18" };
    const later = { ...base, contractId: "Д01-136", dateSigned: "2022-06-30" };
    expect(shared(ropContentKeys(first), ropContentKeys(later))).toEqual([]);
    expect(
      shared(ropSupplierAgnosticKeys(first), ropSupplierAgnosticKeys(later)),
    ).toEqual([]);
  });

  it("matches the same contract across feeds even at a different value", () => {
    const rop = {
      ...base,
      contractId: "134",
      dateSigned: "2020-02-12",
      amountEur: 7556,
    };
    const csv = { ...rop, releaseId: "aop-legacy-2021-9", amountEur: 8325 };
    expect(
      shared(ropContentKeys(rop), ropContentKeys(csv)).length,
    ).toBeGreaterThan(0);
  });
});

describe("buildResolutionMaps", () => {
  it("learns supplier names only from the OTHER feeds, never from РОП rows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rop-maps-"));
    fs.mkdirSync(path.join(dir, "2020"));
    const row = (releaseId: string, name: string, eik: string) => ({
      releaseId,
      awarderEik: "000695114",
      awarderName: "МОН",
      contractorEik: eik,
      contractorName: name,
    });
    fs.writeFileSync(
      path.join(dir, "2020", "2020-01.json"),
      JSON.stringify([
        row("aop-legacy-2020-1", "Павтрейд ЕООД", "175000003"),
        // A list once credited to its first member must not teach the map.
        row("rop-00080-2019-0022-1", "Алта ЕООД,Булгермед ООД", "175000004"),
      ]),
    );
    const m = buildResolutionMaps(dir);
    expect(m.contractorByName.get("павтрейд еоод")).toBe("175000003");
    fs.rmSync(dir, { recursive: true });
    expect([...m.contractorByName.values()]).not.toContain("175000004");
  });

  it("refuses a name no single EIK dominates, keeps one with typo noise", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rop-maps-"));
    fs.mkdirSync(path.join(dir, "2020"));
    const row = (name: string, eik: string) => ({
      releaseId: "aop-legacy-2020-1",
      awarderEik: "000695114",
      awarderName: "МОН",
      contractorEik: eik,
      contractorName: name,
    });
    fs.writeFileSync(
      path.join(dir, "2020", "2020-01.json"),
      JSON.stringify([
        // Two companies, one key once the city is stripped.
        ...Array(6).fill(row("Симекс ЕООД - Кърджали", "108023144")),
        ...Array(4).fill(row("Симекс ЕООД - Криводол", "106577999")),
        // One real EIK plus a single typo'd one.
        ...Array(19).fill(row("Ему АД", "835013079")),
        row("Ему АД", "104053275"),
      ]),
    );
    const m = buildResolutionMaps(dir);
    expect(m.contractorByName.has("симекс еоод")).toBe(false);
    expect(m.contractorByName.get("ему ад")).toBe("835013079");
    fs.rmSync(dir, { recursive: true });
  });
});
