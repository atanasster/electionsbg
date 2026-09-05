import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OBLASTS,
  OBLAST_CODES,
  assertLayerCoverage,
  isOblastCode,
  oblastFromCode,
  oblastFromName,
  oblastPopulation,
  oblastRec,
} from "./oblastCodes";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/**
 * The spellings MEASURED in the four Postgres inputs on 2026-09-05 (`SELECT oblast,
 * count(*) … GROUP BY 1` on each). This list is the contract: it is hermetic, so it runs
 * without a database, and it fails the day a corpus starts spelling an oblast differently —
 * which is the case that would otherwise silently drop a column.
 */
const PG_NAMES: Record<string, string> = {
  Благоевград: "BLG",
  Бургас: "BGS",
  Варна: "VAR",
  "Велико Търново": "VTR",
  Видин: "VID",
  Враца: "VRC",
  Габрово: "GAB",
  Добрич: "DOB",
  Кърджали: "KRZ",
  Кюстендил: "KNL",
  Ловеч: "LOV",
  Монтана: "MON",
  Пазарджик: "PAZ",
  Перник: "PER",
  Плевен: "PVN",
  Пловдив: "PDV",
  Разград: "RAZ",
  Русе: "RSE",
  Силистра: "SLS",
  Сливен: "SLV",
  Смолян: "SML",
  София: "SFO",
  "София (област)": "SFO",
  "София (столица)": "SOF",
  "Стара Загора": "SZR",
  Търговище: "TGV",
  Хасково: "HKV",
  Шумен: "SHU",
  Ямбол: "JAM",
};

describe("oblast codes", () => {
  it("is the 28 census oblasts, code-sorted and unique", () => {
    expect(OBLAST_CODES).toHaveLength(28);
    expect(new Set(OBLAST_CODES).size).toBe(28);
    expect([...OBLAST_CODES].sort()).toEqual([...OBLAST_CODES]);
  });

  it("resolves every oblast name the four Postgres inputs actually use", () => {
    for (const [name, code] of Object.entries(PG_NAMES)) {
      expect(oblastFromName(name), name).toBe(code);
    }
  });

  it("keeps the two Sofias apart", () => {
    // One parenthesis, two places, a 5.5x population gap. Folding them moves €50bn+ of
    // procurement between two columns 40 km apart.
    expect(oblastFromName("София (столица)")).toBe("SOF");
    expect(oblastFromName("София")).toBe("SFO");
    expect(oblastFromName("София (област)")).toBe("SFO");
    expect(oblastRec("SOF")!.population).toBeGreaterThan(
      oblastRec("SFO")!.population * 4,
    );
  });

  it("refuses a name it has never been told about, rather than guessing", () => {
    for (const junk of [
      "",
      "  ",
      "Sofia",
      "СОФИЯ",
      "гр. София",
      "обл. Пловдив",
    ]) {
      expect(oblastFromName(junk), junk).toBeNull();
    }
    expect(oblastFromName(null)).toBeNull();
    expect(oblastFromName(undefined)).toBeNull();
  });

  it("trims what Postgres hands it — padding must not unplace an oblast", () => {
    // These are `text` columns. A trailing space is the classic way a name stops resolving
    // and a whole column silently empties, so the trim is load-bearing rather than tidy.
    expect(oblastFromName("  София ")).toBe("SFO");
    expect(oblastFromName("София (столица)\n")).toBe("SOF");
    expect(oblastFromCode(" PDV-00 ")).toBe("PDV");
    expect(oblastFromCode("\tS22")).toBe("SOF");
    // …but padding is not a licence to guess: an unknown name stays unknown.
    expect(oblastFromName("  Гоце Делчев ")).toBeNull();
  });

  it("does not answer from Object.prototype", () => {
    // A bare object lookup returns an inherited FUNCTION here, which `??` does not catch and
    // TypeScript cannot see through an index signature — so assert the value, not truthiness.
    for (const junk of [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
    ]) {
      expect(oblastFromCode(junk), junk).toBeNull();
      expect(oblastFromName(junk), junk).toBeNull();
    }
  });

  it("folds the МИР / funds codes onto the money grain", () => {
    for (const c of ["S22", "S23", "S24", "S25"]) {
      expect(oblastFromCode(c), c).toBe("SOF");
    }
    expect(oblastFromCode("PDV-00")).toBe("PDV");
    expect(oblastFromCode("PDV")).toBe("PDV");
    expect(oblastFromCode("SFO")).toBe("SFO");
    expect(oblastFromCode("32")).toBeNull(); // МИР 32 is the abroad district
    expect(oblastFromCode("nonsense")).toBeNull();
    expect(oblastFromCode(null)).toBeNull();
  });

  it("places every polygon in data/regions_map.json, and covers all 28 oblasts", () => {
    const fc = JSON.parse(
      fs.readFileSync(path.join(ROOT, "data/regions_map.json"), "utf8"),
    ) as { features: { properties: { nuts3: string } }[] };
    const keys = fc.features.map((f) => f.properties.nuts3);
    expect(keys).toHaveLength(31);
    const covered = new Set<string>();
    for (const k of keys) {
      const code = oblastFromCode(k);
      expect(code, `${k} must fold to an oblast`).not.toBeNull();
      covered.add(code!);
    }
    expect([...covered].sort()).toEqual([...OBLAST_CODES]);
  });

  it("isOblastCode admits only the 28", () => {
    expect(isOblastCode("SOF")).toBe(true);
    // S23 folds to an oblast but is not itself one — the distinction the money layers key on.
    expect(isOblastCode("S23")).toBe(false);
    expect(isOblastCode("PDV-00")).toBe(false);
  });

  it("returns null for a code that is not an oblast", () => {
    expect(oblastRec("NOPE")).toBeNull();
    expect(oblastRec("S23")).toBeNull(); // folds to one, is not one
    expect(oblastFromCode("")).toBeNull();
    expect(oblastFromCode(undefined)).toBeNull();
  });

  it("publishes a population for every oblast", () => {
    const pop = oblastPopulation();
    expect(Object.keys(pop).sort()).toEqual([...OBLAST_CODES]);
    for (const [code, n] of Object.entries(pop)) {
      expect(n, code).toBeGreaterThan(0);
    }
    expect(OBLASTS.every((o) => o.nameBg && o.nameEn)).toBe(true);
  });
});

describe("assertLayerCoverage", () => {
  const full = () => Object.fromEntries(OBLAST_CODES.map((c) => [c, 1]));

  it("passes on a complete layer", () => {
    expect(() => assertLayerCoverage("proc", full(), [])).not.toThrow();
    expect(() =>
      assertLayerCoverage("proc", new Map(OBLAST_CODES.map((c) => [c, 1])), []),
    ).not.toThrow();
  });

  it("names the unplaceable strings rather than dropping them", () => {
    expect(() =>
      assertLayerCoverage("agri", full(), ["Гоце Делчев", "Гоце Делчев"]),
    ).toThrow(/Гоце Делчев/);
  });

  it("sends the operator to the table their resolver actually reads", () => {
    // Three inputs are name-keyed; `fund_projects.oblast` is code-keyed. Naming the wrong
    // table sends an operator to edit a map the failing resolver never consults, after which
    // the refusal repeats with the fix apparently already applied.
    expect(() => assertLayerCoverage("agri", full(), ["х"])).toThrow(
      /NAME_ALIASES/,
    );
    expect(() =>
      assertLayerCoverage("funds", full(), ["S26"], "CODE_FOLD"),
    ).toThrow(/CODE_FOLD/);
  });

  it("refuses a layer with a hole in it", () => {
    const holed = full();
    delete holed.VID;
    expect(() => assertLayerCoverage("funds", holed, [])).toThrow(/VID/);
  });

  it("refuses a Map layer with a hole in it, not just a Record one", () => {
    // `ReadonlyMap` is the shape a euro-accumulating generator naturally uses, so this arm
    // is the one most likely to run — and it was the untested one.
    const holed = new Map(OBLAST_CODES.map((c) => [c, 1]));
    holed.delete("VID");
    expect(() => assertLayerCoverage("proc", holed, [])).toThrow(/VID/);
    expect(() => assertLayerCoverage("proc", holed, [])).toThrow(/1 of 28/);
  });

  it("refuses a Set layer with a hole in it", () => {
    const holed = new Set(OBLAST_CODES);
    holed.delete("SOF");
    expect(() => assertLayerCoverage("arcs", holed, [])).toThrow(/SOF/);
    expect(() =>
      assertLayerCoverage("arcs", new Set(OBLAST_CODES), []),
    ).not.toThrow();
  });

  it("counts an explicit zero as measured, and an absent key as not computed", () => {
    const zeroed = new Map(OBLAST_CODES.map((c) => [c, 0]));
    expect(() => assertLayerCoverage("proc", zeroed, [])).not.toThrow();
    const zeroedRecord = Object.fromEntries(OBLAST_CODES.map((c) => [c, 0]));
    expect(() => assertLayerCoverage("proc", zeroedRecord, [])).not.toThrow();
  });
});
