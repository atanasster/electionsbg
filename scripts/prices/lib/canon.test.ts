// Size parsing + canonical identity, straight off the chain's free-text SKU name.
// No database.
//
// The size is the whole basis of the €/kg and €/L "най-добра стойност" boards,
// so a mis-parse does not degrade — it publishes a real product at a fraction of
// its true unit price and puts it at the TOP of the board.
//
// Runs under `npm run test:unit` (CI). The corpus-derived defect cases live in
// scripts/db/tests/prices_canon.data.test.ts, which is the copy db:refresh's
// final gate runs — see that file's header for the split.
//
// Cases marked ⟨corpus⟩ are literal names from the КЗП feed. The rest are
// minimal synthetic probes for a rule's boundaries — the distinction matters,
// because whether a behaviour is measured or inferred is exactly what a reader
// needs in order to judge a change to it (see the rule-9 boundary block).

import { describe, it, expect } from "vitest";
import { canonicalize, mayMergeAcrossChains } from "./canon";

const size = (name: string, pid = 0, unitPriced = false) => {
  const c = canonicalize(name, pid, unitPriced);
  return { qty: c.netQty, unit: c.netUnit };
};

describe("parseSize — ordinary, unspaced forms", () => {
  it("reads the Cyrillic units", () => {
    expect(size("МИНЕРАЛНА ВОДА ДЕВИН 1.5Л")).toEqual({
      qty: 1500,
      unit: "ml",
    });
    expect(size("КИСЕЛО МЛЯКО 400Г")).toEqual({ qty: 400, unit: "g" });
    expect(size("БРАШНО 1КГ")).toEqual({ qty: 1000, unit: "g" });
    expect(size("ОЛИО 900МЛ")).toEqual({ qty: 900, unit: "ml" });
    expect(size("СИРЕНЕ 250ГР")).toEqual({ qty: 250, unit: "g" });
  });

  it("reads the Latin units", () => {
    expect(size("WATER 1.5L")).toEqual({ qty: 1500, unit: "ml" });
    expect(size("BUTTER 250G")).toEqual({ qty: 250, unit: "g" });
    expect(size("COFFEE 1KG")).toEqual({ qty: 1000, unit: "g" });
    expect(size("JUICE 750ML")).toEqual({ qty: 750, unit: "ml" });
  });

  it("accepts a comma decimal with no space (the feed's usual spelling)", () => {
    expect(size("Черни Маслини Мамут 2,5кг")).toEqual({ qty: 2500, unit: "g" });
    expect(size("МИНЕРАЛНА ВОДА 0,5Л")).toEqual({ qty: 500, unit: "ml" });
  });

  it("tolerates a space between the numeral and its unit", () => {
    expect(size("КАФЕ НА ЗЪРНА PELLINI 1 КГ")).toEqual({
      qty: 1000,
      unit: "g",
    });
    expect(size("Шампоан Nioxin 300 мл")).toEqual({ qty: 300, unit: "ml" });
  });

  it("requires the unit not to run into a word (rule 1's lookahead)", () => {
    // "5 ГОДИНИ" is not 5 grams.
    expect(size("УИСКИ ОТЛЕЖАЛО 5 ГОДИНИ")).toEqual({ qty: null, unit: null });
  });
});

describe("parseSize — spaced decimals (rule 8)", () => {
  // The defect: the numeral matched only "1", the regex resumed at "5 Л." and
  // published a 1.5 L bottle as 5 L — a third of its true €/L, which put four
  // bottled waters at the top of the /consumption/unit-prices L board.
  it("reads a dot decimal with a space after the point", () => {
    expect(size("Минерална Вода Банкя 1. 5 Л.")).toEqual({
      qty: 1500,
      unit: "ml",
    });
    expect(size("Минерална Вода Devin 1. 5 Л.")).toEqual({
      qty: 1500,
      unit: "ml",
    });
    expect(size("Вино Enira Мерло - Енира 0. 75 Л.")).toEqual({
      qty: 750,
      unit: "ml",
    });
  });

  it("reads a dot decimal with a space before the point", () => {
    expect(size("Минерална Вода Горна Баня 1 . 5л")).toEqual({
      qty: 1500,
      unit: "ml",
    });
  });

  it("reads a dot decimal with spaces on both sides", () => {
    expect(size("Минерална Вода White Water 1 . 5 Л.")).toEqual({
      qty: 1500,
      unit: "ml",
    });
  });

  it("applies the same rule to the kg basis", () => {
    expect(size("БРАШНО ТИП 500 1. 5 КГ")).toEqual({ qty: 1500, unit: "g" });
    expect(size("ПРАХ ЗА ПРАНЕ 2 . 5КГ")).toEqual({ qty: 2500, unit: "g" });
  });

  it("reads a spaced COMMA decimal only when the integer part is zero", () => {
    expect(size("Вино Contour Мерло&Сира Контур 0, 75 Л.")).toEqual({
      qty: 750,
      unit: "ml",
    });
  });
});

describe("parseSize — a spaced comma is a LIST separator, not a decimal", () => {
  // 59 of the 60 comma-spaced names in the corpus are enumerations. Reading
  // them as decimals is the same defect pointed the other way: it would inflate
  // 500 g to 9500 g and sink a real product to the BOTTOM of the board.
  it("does not fold a product number into the size", () => {
    expect(size("ПАСТА/СПАГЕТИ BARILLA BUCATINI №9, 500 Г")).toEqual({
      qty: 500,
      unit: "g",
    });
    expect(size("СПАГЕТИ DE CECCO №412, 500 Г")).toEqual({
      qty: 500,
      unit: "g",
    });
    expect(size("МЛЕЧЕН ШОКОЛАД NOVI 1120, 100 Г")).toEqual({
      qty: 100,
      unit: "g",
    });
  });

  it("does not fold an intensity/variant number into the size", () => {
    expect(size("Мляно кафе L'OR Classique, Интензитет 6, 250 гр")).toEqual({
      qty: 250,
      unit: "g",
    });
    expect(size("Кафе на зърна Davidoff Cafe Espresso 57, 1 кг")).toEqual({
      qty: 1000,
      unit: "g",
    });
    expect(size("ПАСТА ЗА ЗЪБИ ASTERA ACT.+ACTIVE 3, 110 Г")).toEqual({
      qty: 110,
      unit: "g",
    });
    expect(
      size("ШАМПОАН GARNIER FRUCTIS ЗА НОРМАЛНА КОСА 2 В 1, 250 МЛ"),
    ).toEqual({ qty: 250, unit: "ml" });
    expect(size("Шампоан Nioxin System 4, 300 мл")).toEqual({
      qty: 300,
      unit: "ml",
    });
  });

  it("does not latch the zero-comma arm onto a larger numeral's trailing zero", () => {
    // Without the (?<![\d.,]) guard "10, 250" would match as "0, 250" → 0.25 g.
    expect(size("Мляно кафе Интензитет 10, 250 гр")).toEqual({
      qty: 250,
      unit: "g",
    });
    expect(size("ШОКОЛАД NOVI 1120, 100 Г")).toEqual({ qty: 100, unit: "g" });
  });

  it("keeps a trailing unspaced comma decimal intact after a list separator", () => {
    expect(size("Черни Маслини Колосал 121/140, 2,5кг")).toEqual({
      qty: 2500,
      unit: "g",
    });
  });
});

describe("parseSize — a spaced DOT is a list separator too", () => {
  // The mirror of the block above. Rule 8's first cut guarded only the comma,
  // on the evidence that all 6 dot-spaced corpus names were genuine decimals.
  // Every name here parsed CORRECTLY before rule 8 and regressed with it, so
  // these are the cases that prove the dot arm needs the same bounds.
  it("does not fold a product number into the size", () => {
    expect(size("ПАСТА BARILLA №9. 500 Г")).toEqual({ qty: 500, unit: "g" });
    expect(size("СПАГЕТИ DE CECCO №11. 500 Г")).toEqual({
      qty: 500,
      unit: "g",
    });
    expect(size("ШОКОЛАД NOVI 1120. 100 Г")).toEqual({ qty: 100, unit: "g" });
  });

  it("does not fold an intensity/variant number into the size", () => {
    expect(size("Мляно кафе Интензитет 10. 250 гр")).toEqual({
      qty: 250,
      unit: "g",
    });
    expect(size("ПАСТА ЗА ЗЪБИ ASTERA 3. 110 Г")).toEqual({
      qty: 110,
      unit: "g",
    });
    expect(size("Шампоан Nioxin System 4. 300 мл")).toEqual({
      qty: 300,
      unit: "ml",
    });
    expect(size("ШАМПОАН GARNIER 2 В 1. 250 МЛ")).toEqual({
      qty: 250,
      unit: "ml",
    });
  });

  it("never INFLATES a size — the top-of-board direction", () => {
    expect(size("Кафе на зърна Davidoff Espresso 57. 1 кг")).toEqual({
      qty: 1000,
      unit: "g",
    });
    expect(size("ВИНО РОЗЕ ПАРТИДА №11. 5 Л")).toEqual({
      qty: 5000,
      unit: "ml",
    });
  });

  it("still reads the genuine spaced decimals, and the unspaced ones", () => {
    expect(size("Минерална Вода Банкя 1. 5 Л.")).toEqual({
      qty: 1500,
      unit: "ml",
    });
    expect(size("Вино Enira Мерло 0. 75 Л.")).toEqual({ qty: 750, unit: "ml" });
    expect(size("ПРАХ ЗА ПРАНЕ 2 . 5КГ")).toEqual({ qty: 2500, unit: "g" });
    expect(size("ЗАХАР 12.5 КГ")).toEqual({ qty: 12500, unit: "g" });
    expect(size("БРАШНО 1.500 Г")).toEqual({ qty: 1.5, unit: "g" });
  });
});

describe("parseSize — the invariant every separator rule must hold", () => {
  it("no rule may read a size LARGER than the biggest numeral in the name", () => {
    // A separator rule can only ever move a decimal point LEFTWARD. If a parse
    // comes out above every literal numeral in the name, an enumeration was
    // folded into the size — which is the inflating direction that puts a
    // product at the top of a "най-добра стойност" board. This catches the
    // whole class without enumerating cases, so a future arm cannot reopen it.
    const names = [
      "Кафе на зърна Davidoff Espresso 57. 1 кг",
      "ВИНО РОЗЕ ПАРТИДА №11. 5 Л",
      "СПАГЕТИ DE CECCO №11. 500 Г",
      "Мляно кафе Интензитет 10, 250 гр",
      "ШАМПОАН GARNIER 2 В 1. 250 МЛ",
      "ШОКОЛАД NOVI 1120. 100 Г",
      "Минерална Вода Банкя 1. 5 Л.",
      "Вино Contour Мерло&Сира Контур 0, 75 Л.",
      "ВИНО A GOOD YEAR КЮВЕ 075Л",
    ];
    for (const n of names) {
      const c = canonicalize(n, 0);
      if (c.netQty == null) continue;
      // x1000 because the numeral is in the display unit (Л/КГ) while netQty
      // is in the base one (ml/g).
      const biggest = Math.max(...(n.match(/\d+/g) ?? ["0"]).map(Number));
      expect(c.netQty, n).toBeLessThanOrEqual(biggest * 1000);
    }
  });
});

describe("parseSize — multipacks (rule 7)", () => {
  it("multiplies the pack out", () => {
    expect(size("МИНЕРАЛНА ВОДА 6х1.5Л")).toEqual({ qty: 9000, unit: "ml" });
    expect(size("БИРА 6x500МЛ")).toEqual({ qty: 3000, unit: "ml" });
  });

  it("records the count as an attribute so a pack never merges with a single", () => {
    expect(canonicalize("МИНЕРАЛНА ВОДА 6х1.5Л", 0).attrs.count).toBe("6");
    expect(canonicalize("МИНЕРАЛНА ВОДА 1.5Л", 0).attrs.count).toBeUndefined();
    expect(canonicalize("МИНЕРАЛНА ВОДА 6х1.5Л", 0).canonKey).not.toBe(
      canonicalize("МИНЕРАЛНА ВОДА 1.5Л", 0).canonKey,
    );
  });

  it("reads a spaced decimal inside a multipack too", () => {
    expect(size("МИНЕРАЛНА ВОДА 6 х 1. 5 Л")).toEqual({
      qty: 9000,
      unit: "ml",
    });
  });
});

describe("parseSize — a decimal separator lost entirely (rule 9)", () => {
  // 075Л wines held nine of the first ten places on the €/L board, at 100x
  // their true size. HOUSEHOLD_PACK_MAX_G hides this class on the kg basis;
  // the L basis has no ceiling, so it surfaced there.
  it("reads a leading-zero numeral on a LARGE unit as a fraction", () => {
    expect(size("ВИНО A GOOD YEAR КЮВЕ 075Л")).toEqual({
      qty: 750,
      unit: "ml",
    });
    expect(size("БВ Контемплейшън Шардоне/Совин 075л. Мезек")).toEqual({
      qty: 750,
      unit: "ml",
    });
    expect(size("РАКИЯ 05Л")).toEqual({ qty: 500, unit: "ml" });
    expect(size("МАСЛО 0250КГ")).toEqual({ qty: 250, unit: "g" });
  });

  it("leaves a leading zero on a SMALL unit alone — it is only padding", () => {
    expect(size("ЕЙНДЖЪЛС ШАРДОНЕ 0375МЛ")).toEqual({ qty: 375, unit: "ml" });
    expect(size("ПОМОРИЙСКА СПЕЦ. РАКИЯ 0700МЛ")).toEqual({
      qty: 700,
      unit: "ml",
    });
    expect(size("ПОДПРАВКА 010ГР")).toEqual({ qty: 10, unit: "g" });
  });

  it("does not touch a numeral that already carries its separator", () => {
    expect(size("ВИНО 0.75Л")).toEqual({ qty: 750, unit: "ml" });
    expect(size("ВИНО 0,75Л")).toEqual({ qty: 750, unit: "ml" });
    expect(size("ВОДА 0 Л")).toEqual({ qty: 0, unit: "ml" });
  });

  it("does NOT apply to the spaced form, which is not separable from a code", () => {
    // Flour of TYPE 0 in a 1 kg bag — a spaced rule would publish it as 100 g.
    expect(size("БРАШНО БИО ALCE NERO ПШЕНИЧНО ТИП 0 1 КГ")).toEqual({
      qty: 1000,
      unit: "g",
    });
    // Product code HM-0, then the real 400 g size.
    expect(size("МЛЯКО NAN 1 ОПТИПРО HM-0 400 ГР")).toEqual({
      qty: 400,
      unit: "g",
    });
  });
});

describe("parseSize — rule 9's digit-count boundary", () => {
  it("pins which digit-counts are measured and which are inferred", () => {
    // ⟨corpus⟩ — the 18 measured instances are all THREE digits or more.
    expect(size("ВИНО 075Л")).toEqual({ qty: 750, unit: "ml" });
    expect(size("ВИНО 0375МЛ")).toEqual({ qty: 375, unit: "ml" });
    expect(size("РАКИЯ 0700МЛ")).toEqual({ qty: 700, unit: "ml" });
    // Synthetic. Two digits on a large unit is an EXTRAPOLATION beyond those 18
    // — kept because it errs downward (see the ⚠️ in canon.ts). Pinned so that
    // changing it is a decision, not a side effect of touching the regex.
    expect(size("РАКИЯ 05Л")).toEqual({ qty: 500, unit: "ml" });
    expect(size("БРАШНО 01КГ")).toEqual({ qty: 100, unit: "g" });
    // Four digits on a large unit: also inferred, also downward.
    expect(size("ВИНО 0075Л")).toEqual({ qty: 75, unit: "ml" });
  });

  it("never applies the rule to a small unit, at any digit count", () => {
    expect(size("ПОДПРАВКА 010ГР")).toEqual({ qty: 10, unit: "g" });
    expect(size("СИРОП 05МЛ")).toEqual({ qty: 5, unit: "ml" });
  });
});

describe("canonicalize — identity around the fixed size", () => {
  it("a correctly-sized bottle no longer shares a key with a 5 L one", () => {
    expect(canonicalize("Минерална Вода Банкя 1. 5 Л.", 21).canonKey).not.toBe(
      canonicalize("Минерална Вода Банкя 5 Л.", 21).canonKey,
    );
  });

  it("the two spellings of 1.5 L converge on ONE key", () => {
    expect(canonicalize("Минерална Вода Банкя 1. 5 Л.", 21).canonKey).toBe(
      canonicalize("Минерална Вода Банкя 1.5Л", 21).canonKey,
    );
  });

  it("still collapses the size dimension for a unit-priced good", () => {
    expect(canonicalize("БАНАНИ 1 КГ", 5, true).canonKey).toBe(
      canonicalize("БАНАНИ", 5, true).canonKey,
    );
  });

  it("a 075Л bottle now measures the same as its 0.75Л spelling", () => {
    // The two still take different canon_keys — tokenize() keeps "075Л" and
    // "75Л" as distinct tokens — so they do not MERGE. What rule 9 fixes is the
    // published size, which is what the €/L board divides by.
    const a = canonicalize("ВИНО A GOOD YEAR КЮВЕ 075Л", 0);
    const b = canonicalize("ВИНО A GOOD YEAR КЮВЕ 0.75Л", 0);
    expect(a.netQty).toBe(b.netQty);
    expect(a.netQty).toBe(750);
  });

  it("lets a parsed size merge across chains", () => {
    expect(mayMergeAcrossChains(canonicalize("ВОДА 1. 5 Л.", 21))).toBe(true);
    expect(mayMergeAcrossChains(canonicalize("ВОДА БУТИЛКА", 21))).toBe(false);
  });
});
