// Cases carried over from the deleted `scripts/declarations/build_company_index.test.ts`, whose
// `normalizeCompanyName` block this fold is. The bug that file locked — a political party
// splitting into one entry per spelling, each holding a different subset of the years — is the
// same bug in a different place now: the party used to split across index ENTRIES and would
// now split across a person's declared holdings.

import { describe, expect, it } from "vitest";
import { foldCompanyName } from "./companyNameFold";

describe("foldCompanyName — the party legal-form PREFIX", () => {
  it("collapses the spelled-out form onto the abbreviation", () => {
    expect(foldCompanyName('Политическа партия "Движение ДА българия"')).toBe(
      foldCompanyName("ПП Движение ДА българия"),
    );
    expect(foldCompanyName("Политическа партия «Зелено движение»")).toBe(
      foldCompanyName("ПП Зелено движение"),
    );
  });

  it("collapses a coalition's two spellings", () => {
    expect(foldCompanyName("Коалиция Продължаваме промяната")).toBe(
      foldCompanyName("КП Продължаваме промяната"),
    );
  });

  it("requires a following space, so a name merely BEGINNING with those letters survives", () => {
    // „ППСервиз" is one word. Stripping a prefix that is not a prefix would rename the company.
    expect(foldCompanyName("ППСервиз ООД")).toBe("ппсервиз");
    expect(foldCompanyName("ПП Сервиз ООД")).not.toBe(
      foldCompanyName("ППСервиз ООД"),
    );
  });
});

describe("foldCompanyName — the commercial legal-form SUFFIX", () => {
  it("strips a space-separated trailing form", () => {
    expect(foldCompanyName("Отзвук ЕООД")).toBe(foldCompanyName("«Отзвук»"));
  });

  it("strips a glued form only after a NON-letter", () => {
    // The digit before ООД is the word boundary.
    expect(foldCompanyName('"МИД 2000"ООД')).toBe(
      foldCompanyName("МИД 2000 ООД"),
    );
  });

  it("does not lop ЕТ off a word that merely ends in it", () => {
    expect(foldCompanyName("ПП Полет")).toBe("полет");
  });

  it("prefers the longer form (ЕООД before ООД, АДСИЦ before АД)", () => {
    expect(foldCompanyName("Алфа ЕООД")).toBe("алфа");
    expect(foldCompanyName("Алфа АДСИЦ")).toBe("алфа");
  });
});

describe("foldCompanyName — quotes and whitespace", () => {
  it.each([
    '"Проба" ООД',
    "“Проба” ООД",
    "„Проба“ ООД",
    "«Проба» ООД",
    "＂Проба＂ ООД",
    "  Проба   ООД ",
  ])("folds %s to the same key", (raw) => {
    expect(foldCompanyName(raw)).toBe("проба");
  });

  it("keeps a digit run that is part of the name", () => {
    expect(foldCompanyName("ПП Проба 2000ООД")).toBe("проба 2000");
  });
});

describe("foldCompanyName — the hyphen clause", () => {
  // ⚠️ THE ADDITION over the rule this was ported from, and what takes the split count against
  // the retired companySlug to zero: that slug replaced whitespace with `-` and collapsed runs,
  // so it folded these together as a side effect.
  it.each([
    ["ФИЛ - КОМЕРС ООД", "ФИЛ-КОМЕРС ООД"],
    ["Метал Инвест-Габрово ООД", "Метал Инвест Габрово ООД"],
    ["Родопи - 95 АД", "Родопи 95 АД"],
    ["Гала-Н ЕООД", "Гала Н ЕООД"],
  ])("folds %s and %s together", (a, b) => {
    expect(foldCompanyName(a)).toBe(foldCompanyName(b));
  });

  it("runs AFTER the suffix strip, so a hyphenated name still loses its legal form", () => {
    // If the hyphen fold ran first, „фил-комерс оод" would already read as one token run and
    // the suffix stripper would still find „ оод" — but „ПЛЕВЕН-ИНТЕРТРАНС ЕООД" is the case
    // that decides it: the form must be a trailing token when it is stripped.
    expect(foldCompanyName("ПЛЕВЕН-ИНТЕРТРАНС ЕООД")).toBe("плевен интертранс");
  });
});

describe("foldCompanyName — degenerate input", () => {
  it.each([null, undefined, "", "   "])(
    "returns an empty key for %s",
    (raw) => {
      expect(foldCompanyName(raw)).toBe("");
    },
  );

  it("does not fold two different companies onto each other", () => {
    expect(foldCompanyName("Алфа ООД")).not.toBe(foldCompanyName("Бета ООД"));
  });
});
