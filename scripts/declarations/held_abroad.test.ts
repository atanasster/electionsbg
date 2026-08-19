import { describe, expect, it } from "vitest";
import { classifyHeldPlace, countryOf } from "./held_abroad";

// Mirrors classifyHeldPlace's own signature — `undefined` is a real input here (a shard row
// whose table has no such cells), so the helper must not be narrower than the rule it tests.
const scope = (a: string | null | undefined, b: string | null | undefined) =>
  classifyHeldPlace(a, b).scope;

describe("classifyHeldPlace — the ordinary fillings", () => {
  it("reads a tick in one column and nothing in the other", () => {
    expect(scope("да", "")).toBe("domestic");
    expect(scope("", "да")).toBe("abroad");
    expect(scope("х", "")).toBe("domestic");
    expect(scope("", "Х")).toBe("abroad");
  });

  it("reads the dominant tick-and-deny pair (18.3% of the corpus)", () => {
    expect(scope("да", "не")).toBe("domestic");
    expect(scope("ДА", "НЕ")).toBe("domestic");
    expect(scope("не", "да")).toBe("abroad");
  });

  // The pair is exhaustive by construction — the money is either in the country or outside
  // it — so a denial in one column is a positive statement about the other. 81 rows make no
  // other statement at all, and reading the denial as an empty cell throws them away.
  it("treats a lone denial as an assertion about the OTHER column", () => {
    expect(scope("", "не")).toBe("domestic");
    expect(scope("", "0")).toBe("domestic");
    expect(scope("", "няма")).toBe("domestic");
    expect(scope("не", "")).toBe("abroad");
  });
});

describe("classifyHeldPlace — content overrides the column it sits in", () => {
  // 47 rows put a domestic answer inside „В чужбина" and 17 the reverse. Position alone
  // gets every one of them backwards.
  it('reads „в страната" / „България" as domestic wherever it appears', () => {
    expect(scope("", "в страната")).toBe("domestic");
    expect(scope("", "България")).toBe("domestic");
    expect(scope("", "Р България")).toBe("domestic");
  });

  it('reads „в чужбина" and a country as abroad wherever it appears', () => {
    expect(scope("в чужбина", "")).toBe("abroad");
    expect(scope("Гърция", "")).toBe("abroad");
    expect(classifyHeldPlace("Кипър (Trading 212)", "").country).toBe("Кипър");
  });
});

describe("classifyHeldPlace — the specificity tiers", () => {
  // „х" is a tick to some filers and a strike-through to others, and nothing in the cell
  // says which. When the other column NAMES a place, that is the filing's real answer.
  it("lets a named place beat a bare tick in the other column", () => {
    expect(scope("РБългария", "х")).toBe("domestic");
    expect(scope("България", "х")).toBe("domestic");
    expect(scope("в страната", "х")).toBe("domestic");
  });

  it("lets content beat a bare tick", () => {
    expect(scope("Първа Инвестиционна Банка АД", "х")).toBe("domestic");
  });

  // Two claims at the SAME specificity are a genuine contradiction and must not be
  // resolved by picking a side.
  it("refuses a tie at the top tier", () => {
    expect(scope("да", "да")).toBe("unknown");
    expect(scope("да", "х")).toBe("unknown");
    expect(scope("В страната", "В чужбина")).toBe("unknown");
    expect(scope("Amundi Funds", "Amundi Funds")).toBe("unknown");
  });
});

describe("classifyHeldPlace — 'unknown' is an answer, not a fallback", () => {
  it("never resolves a blank pair to domestic", () => {
    expect(scope("", "")).toBe("unknown");
    expect(scope(null, null)).toBe("unknown");
    expect(scope(undefined, undefined)).toBe("unknown");
  });

  // ~93 rows split one amount across the two columns: 151,744 + 967 = the 152,711 in the
  // amount cell. Neither scope is true of the whole row, so neither is asserted.
  it("refuses a split amount rather than picking the larger side", () => {
    expect(scope("151744", "967")).toBe("unknown");
    expect(scope("30000", "20000")).toBe("unknown");
  });

  it("ignores spreadsheet residue rather than reading it as an answer", () => {
    expect(scope("да", "-'Стр. 7'!M1512")).toBe("domestic");
    expect(scope("да", "------------------------------")).toBe("domestic");
    expect(scope("", "-B47х")).toBe("unknown");
  });

  it("ignores a one- or two-character slip that is not a known tick", () => {
    expect(scope("да", "ни")).toBe("domestic");
    expect(scope("да", "те")).toBe("domestic");
    expect(scope("ь", "")).toBe("unknown");
  });
});

describe("countryOf", () => {
  it("finds a country inside a fund or bank name", () => {
    expect(countryOf("VONTOBEL Швейцария")).toBe("Швейцария");
    expect(countryOf("AmundiFundsChinaEquity Люксембург")).toBe("Люксембург");
    expect(countryOf("банка BCR, Румъния")).toBe("Румъния");
    expect(countryOf("x (ING Belgium)")).toBe("Белгия");
    expect(countryOf("(Револют) Литва")).toBe("Литва");
  });

  it("normalises the register's variants and typos onto one canonical name", () => {
    expect(countryOf("Гермавия")).toBe("Германия");
    expect(countryOf("Р ТУРЦИЯ")).toBe("Турция");
    expect(countryOf("Република Турция")).toBe("Турция");
    expect(countryOf("Съединени американски щати")).toBe("САЩ");
    expect(countryOf("Холандия")).toBe("Нидерландия");
    expect(countryOf("Обединеното кралство")).toBe("Обединеното кралство");
    expect(countryOf("Великобритания")).toBe("Обединеното кралство");
  });

  // JS `\b` is ASCII-only, so „сащ\b" matches nothing at all — every САЩ row was silently
  // losing its country until the boundary was written as a Cyrillic lookaround.
  it("matches a short Cyrillic name that ASCII word boundaries cannot", () => {
    expect(countryOf("САЩ")).toBe("САЩ");
    expect(countryOf("Kraneshares CSI ChinaIntern САЩ")).toBe("САЩ");
  });

  it("does not invent a country from an institution or a tick", () => {
    expect(countryOf("Bank of China")).toBeNull();
    expect(countryOf("Revolut")).toBeNull();
    expect(countryOf("Amundi Funds")).toBeNull();
    expect(countryOf("да")).toBeNull();
    expect(countryOf("")).toBeNull();
  });

  it("names no country on a domestic row, whatever the cell says", () => {
    expect(classifyHeldPlace("България", "").country).toBeNull();
    expect(classifyHeldPlace("да", "не").country).toBeNull();
  });
});
