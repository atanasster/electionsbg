import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ABROAD_CITIES_PATH,
  AMBIGUOUS_CITIES,
  COUNTRY_ALIASES,
  abroadCityTable,
  cityKey,
  countryKey,
  resolveAbroadCity,
} from "./abroad";
import { buildTable, countryIndex, harvest } from "./build_abroad_cities";
import { assertCommitted } from "../lib/assert_committed";
import { corpusRound } from "./testCorpus";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

assertCommitted(
  "data/presidential/abroad_cities.json",
  "data/settlements.json",
);

const settlements = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, "data/settlements.json"), "utf8"),
) as { name: string; ekatte: string; oblast: string }[];

describe("cityKey", () => {
  it("strips the „гр.“ prefix 2001 puts on every settlement", () => {
    expect(cityKey("гр. Сидней")).toBe("сидней");
    expect(cityKey("Сидней")).toBe("сидней");
  });

  // ⚠ §2.5-12. The 2006 sections file spells Melbourne with a LATIN M and Villalba with a
  // LATIN a. Both look right to a reader and match nothing, so a Cyrillic-only lookup
  // drops two real polling stations with every count still reconciling.
  it("folds a Latin homoglyph that has strayed into a Cyrillic word", () => {
    expect("Mелбърн".codePointAt(0), "the M really is Latin").toBe(0x4d);
    expect(cityKey("Mелбърн")).toBe(cityKey("Мелбърн"));
    expect(cityKey("Mелбърн")).toBe("мелбърн");
    expect([..."Вилялбa"].at(-1)!.codePointAt(0), "the a really is Latin").toBe(
      0x61,
    );
    expect(cityKey("Вилялбa")).toBe(cityKey("Вилялба"));
  });

  // ⚠ THE HALF THAT IS EASY TO GET WRONG, and it shipped wrong once. „Пърт, UK" is a real
  // corpus entry whose UK is genuinely Latin; folding its K to Cyrillic „К" rewrites a
  // correct string into one that matches nothing, and the city silently left the table.
  it("leaves a wholly-Latin token alone", () => {
    expect(cityKey("Пърт, UK")).toBe("пърт, uk");
    expect(cityKey("Пърт, UK")).not.toBe("пърт, uк");
    expect(cityKey("New York")).toBe("new york");
  });

  it("folds before lowercasing, which is what makes the uppercase case work", () => {
    // Lowercasing first turns Latin „M" into Latin „m", which is NOT a homoglyph of
    // Cyrillic „м" — so the map misses it and Melbourne resolves to nothing. Pinned as a
    // control: this expectation fails under the other order.
    const lowerFirst = [..."Mелбърн".toLowerCase()]
      .map((ch) => ({ m: "м" })[ch as "m"] ?? ch)
      .join("");
    expect(cityKey("Mелбърн")).toBe(lowerFirst);
    // …and the naive version that only maps uppercase would leave the Latin m behind.
    const naive = [..."Mелбърн".toLowerCase()].join("");
    expect(cityKey("Mелбърн")).not.toBe(naive);
  });

  it("does not fold Cyrillic letters into each other", () => {
    // A fuzzy key would merge two real places, and each is a different country's votes.
    expect(cityKey("Бургас")).not.toBe(cityKey("Бургаз"));
  });
});

describe("the committed table", () => {
  it("is what the generator produces from the committed corpora", () => {
    // ⚠ The regeneration is the gate. The file is committed and the aggregator reads it,
    // so a hand edit — or a generator change nobody re-ran — would otherwise ship a
    // country map nothing derived.
    const built = buildTable(
      harvest(path.join(PROJECT_ROOT, "raw_data"), countryIndex(settlements)),
    ).table;
    expect(built.cities).toEqual(abroadCityTable().cities);
    expect(built.ambiguous).toEqual(abroadCityTable().ambiguous);
    // Byte-stable: nothing in the build reads the clock or a set's iteration order.
    expect(`${JSON.stringify(built, null, 2)}\n`).toBe(
      fs.readFileSync(ABROAD_CITIES_PATH, "utf8"),
    );
  });

  it("maps every city to a country the settlement catalogue carries", () => {
    // ⚠ An id the catalogue does not have would put a country on the map that no other
    // surface can render — the reason `COUNTRY_ALIASES` may only rename, never invent.
    const known = new Set(
      settlements.filter((s) => s.oblast === "32").map((s) => s.ekatte),
    );
    const t = abroadCityTable();
    // ⚠ A FLOOR, and it has to sit near the measured value to mean anything. At 900 it
    // was below every outcome of dropping a source cycle (915–966 measured), so it
    // would have passed the exact narrowing it exists to catch.
    expect(Object.keys(t.cities).length).toBeGreaterThanOrEqual(1_248);
    for (const [city, id] of Object.entries(t.cities)) {
      expect(known.has(id), `${city} → ${id}`).toBe(true);
    }
    for (const id of Object.values(COUNTRY_ALIASES)) {
      expect(known.has(id), id).toBe(true);
    }
  });

  it("refuses four cities rather than choosing between two real places", () => {
    // ⚠ Each is a real place in two countries with sections recorded in both, so no
    // evidence here can say which an older protocol meant. THREE OF THE FOUR appeared
    // only when the harvest learned the older layouts: on half the record Бостън resolved
    // confidently to GB, Оукланд to NZ and Триполи to GR.
    expect(AMBIGUOUS_CITIES).toEqual(["Бостън", "Оукланд", "Пърт", "Триполи"]);
    expect(abroadCityTable().ambiguous).toEqual([
      "Бостън",
      "Оукланд",
      "Пърт",
      "Триполи",
    ]);
    for (const city of AMBIGUOUS_CITIES) {
      expect(resolveAbroadCity(city), city).toBeNull();
    }
    expect(resolveAbroadCity("Пърт")).toBeNull();
    expect(resolveAbroadCity("Пърт, UK")).toBe("GB");
    expect(resolveAbroadCity("Пърт, AU")).toBe("AU");
  });

  // ⚠ The generator THROWS when the constant and the corpus disagree, in either
  // direction. A stale „this city is ambiguous" reads as a decision somebody checked.
  it("refuses to build when AMBIGUOUS_CITIES has gone stale", () => {
    const h = harvest(
      path.join(PROJECT_ROOT, "raw_data"),
      countryIndex(settlements),
    );
    // Make Sofia ambiguous, which the constant does not declare.
    const forged = new Map(h.cities);
    forged.set(cityKey("Канбера"), new Set(["AU", "GB"]));
    expect(() => buildTable({ ...h, cities: forged })).toThrow(
      /newly ambiguous/,
    );
    // …and drop the one it does declare.
    const flattened = new Map(h.cities);
    flattened.set(cityKey("Пърт"), new Set(["AU"]));
    expect(() => buildTable({ ...h, cities: flattened })).toThrow(
      /no longer ambiguous/,
    );
  });

  // ⚠ Dropping an unresolvable country name is NOT free — it manufactures certainty.
  // Measured: without the alias table, „Пърт" resolved cleanly to Australia, because the
  // UK spelling beside it had been discarded and the city then looked unambiguous.
  it("would make Perth look unambiguous if the aliases were dropped", () => {
    const noAliases: Record<string, string> = Object.create(null);
    for (const x of settlements) {
      if (x.oblast === "32") noAliases[countryKey(x.name)] = x.ekatte;
    }
    const h = harvest(path.join(PROJECT_ROOT, "raw_data"), noAliases);
    expect(h.cities.get(cityKey("Пърт"))?.size, "one country, wrongly").toBe(1);
    // With them, the evidence is complete and the city is refused.
    const full = harvest(
      path.join(PROJECT_ROOT, "raw_data"),
      countryIndex(settlements),
    );
    expect(full.cities.get(cityKey("Пърт"))?.size).toBe(2);
  });

  it("names the country it still cannot resolve, rather than inventing an id", () => {
    // ⚠ „Индонезия" appears in the feed and `settlements.json` has no Indonesia, so it is
    // deliberately absent from COUNTRY_ALIASES: an alias may only RENAME a country the
    // catalogue carries, never mint one no other surface can render.
    const h = harvest(
      path.join(PROJECT_ROOT, "raw_data"),
      countryIndex(settlements),
    );
    expect([...h.unknownCountries]).toEqual(["Индонезия"]);
    expect(Object.keys(COUNTRY_ALIASES)).not.toContain("Индонезия");
  });

  // ⚠ A NON-BREAKING SPACE COST A COUNTRY, and nothing about it is visible. The corpus
  // spells Bosnia „Босна\u00a0и Херцеговина" while the catalogue uses an ordinary space,
  // so the two render identically, compare unequal, and the country resolved to nothing.
  // It surfaced only because a test printed two „identical" values that were not equal.
  it("resolves a country whose corpus spelling uses a non-breaking space", () => {
    const nbsp = "Босна\u00a0и Херцеговина";
    const plain = "Босна и Херцеговина";
    expect(nbsp).not.toBe(plain);
    expect(countryKey(nbsp)).toBe(countryKey(plain));
    expect(countryIndex(settlements)[countryKey(nbsp)]).toBe("BA");
    expect(resolveAbroadCity("Сараево")).toBe("BA");
  });

  // ⚠ 2005 publishes abroad sections as a bare city with NO country, so it legitimately
  // contributes nothing — and a cycle whose layout the harvest has stopped understanding
  // looks exactly the same from here. Naming them is what tells the two apart; counting
  // them as read is how four cycles were silently lost.
  it("names the cycles that yielded no country evidence", () => {
    const h = harvest(
      path.join(PROJECT_ROOT, "raw_data"),
      countryIndex(settlements),
    );
    expect(h.cyclesRead.length).toBe(13);
    expect(h.cyclesWithoutCountries).toEqual(["2005_06_25"]);
  });

  it("reads the four older layouts, not only the modern one", () => {
    // ⚠ The regression that shipped: the first harvest understood only the 2017-and-later
    // shape, so 2013 and 2014 matched nothing. Their evidence is what named Сидней and
    // what exposed three cities as genuinely ambiguous.
    const h = harvest(
      path.join(PROJECT_ROOT, "raw_data"),
      countryIndex(settlements),
    );
    expect(h.cities.get(cityKey("Сидней")), "2014 names it").toEqual(
      new Set(["AU"]),
    );
    expect(
      resolveAbroadCity("гр. Сидней"),
      "so the 2001 spelling resolves",
    ).toBe("AU");
  });
});

describe("resolving the presidential corpus", () => {
  const PRE_2016 = ["2001_11_11_pvr", "2006_10_22_pvr", "2011_10_23_pvr"];

  it("places most abroad sections and leaves the rest null", () => {
    // ⚠ MEASURED, and the residue is the design. T3.1: an unresolved abroad section is
    // written with `country: null` and LISTED, never dropped and never guessed. The
    // figure moved 744 → 792 when the harvest learned the four older layouts, so it is
    // pinned rather than bounded: a silent slide back is the regression to catch.
    let total = 0;
    let resolved = 0;
    for (const cycle of PRE_2016) {
      for (const round of [1, 2] as const) {
        const abroad = corpusRound(cycle, round).sections.filter(
          (s) => s.abroad,
        );
        total += abroad.length;
        resolved += abroad.filter((s) =>
          resolveAbroadCity(s.abroad!.city),
        ).length;
      }
    }
    expect(total).toBe(876);
    expect(resolved).toBe(792);
    expect(resolved / total).toBeGreaterThan(0.9);
  });

  it("resolves Melbourne, whose 2006 spelling carries a Latin M", () => {
    const abroad = corpusRound("2006_10_22_pvr", 1).sections.filter(
      (s) => s.abroad,
    );
    const melbourne = abroad.find((s) => s.abroad!.city === "Mелбърн");
    expect(melbourne, "the Latin-M spelling is in the corpus").toBeDefined();
    expect(resolveAbroadCity(melbourne!.abroad!.city)).toBe("AU");
  });

  it("resolves 2011's Канбера, which its own reader could only name as a city", () => {
    const canberra = corpusRound("2011_10_23_pvr", 1).sections.find(
      (s) => s.abroad?.city === "Канбера",
    );
    expect(canberra, "2011 names only a city").toBeDefined();
    expect(
      canberra!.abroad!.country,
      "and the reader never guesses it",
    ).toBeNull();
    expect(resolveAbroadCity("Канбера"), "the table is what supplies it").toBe(
      "AU",
    );
  });

  // ⚠ THE OTHER HOMOGLYPH CITY FOLDS CORRECTLY AND STILL RESOLVES TO NULL, and saying so
  // is the point. „Вилялбa" carries a Latin a and the fold repairs it — but the
  // parliamentary corpus only ever spells the place „Колядо Вилялба", so no evidence
  // names its country. Two different failures wear the same null, and a comment claiming
  // the fold „rescues both cities" would be describing one.
  it("folds Villalba correctly and still cannot name its country", () => {
    const villalba = corpusRound("2006_10_22_pvr", 1).sections.find(
      (s) => s.abroad?.city === "Вилялбa",
    );
    expect(villalba, "the Latin-a spelling is in the corpus").toBeDefined();
    expect(cityKey("Вилялбa"), "the fold does its job").toBe("вилялба");
    expect(
      resolveAbroadCity("Вилялбa"),
      "and the corpus still cannot say",
    ).toBeNull();
    expect(resolveAbroadCity("Колядо Вилялба"), "the named place").toBe("ES");
  });

  // ⚠⚠ THE TABLE WILL HAPPILY ANSWER FOR A BULGARIAN VILLAGE, so the caller's abroad flag
  // is the gate — not this lookup. Nine keys are also domestic settlement names, each a
  // real foreign city Bulgaria has run a section in. Asserted as the hazard it is rather
  // than as a reassurance: an earlier version of this test only counted domestic sections
  // and never called the resolver, so it could not have failed.
  it("answers for names that are also Bulgarian villages", () => {
    const domesticNames = new Set(
      settlements
        .filter((s) => s.oblast !== "32")
        .map((s) => s.name.toLowerCase()),
    );
    const collisions = Object.keys(abroadCityTable().cities).filter((k) =>
      domesticNames.has(k),
    );
    expect(collisions.sort()).toEqual([
      "димитровград",
      "есен",
      "кортен",
      "мугла",
      "охрид",
      "подгорица",
      "прилеп",
      "сараево",
      "тетово",
    ]);
    expect(resolveAbroadCity("Димитровград")).toBe("RS");
    expect(resolveAbroadCity("Охрид")).toBe("MK");
  });

  it("never returns a value for a key the table does not carry", () => {
    // ⚠ A plain object answers `cities["constructor"]` with a Function — truthy, and
    // returned under a signature promising `string | null`. City strings reach this
    // straight from a raw file, so the input is not ours to trust.
    for (const probe of [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
    ]) {
      expect(resolveAbroadCity(probe), probe).toBeNull();
    }
  });
});
