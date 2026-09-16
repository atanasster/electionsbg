import { describe, expect, it } from "vitest";
import {
  extractEntities,
  fillMissingArgs,
  hasEntities,
  renderEntityHint,
  type ExtractedEntities,
} from "./entityExtraction";
import { STARTERS } from "../app/starters";

// Phase-2 gate (plan C8): entity extraction must be MEASURED, not asserted.
//
// The plan asks for a precision floor AND a recall floor, because the two errors are
// not symmetric. A missed entity costs a hint the model could still infer; a WRONG
// entity is written into the prompt as fact. So the numbers below are per slot, and
// the fill path is held to a much higher standard than the hint path.
//
// Ground truth is the starter bank's OWN expected args — the same corpus the argument
// gate uses — which means these floors move with it and cannot be self-certified.

const goldYear = (args: Record<string, unknown> | undefined): number | null => {
  const v = args?.year ?? args?.election;
  if (v === undefined) return null;
  const m = String(v).match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
};

const STATS = (() => {
  let goldYearQuestions = 0,
    singleYear = 0,
    singleYearCorrect = 0,
    yearHintTotal = 0,
    yearHintCorrect = 0,
    indTP = 0,
    indFP = 0,
    indFN = 0,
    placeGold = 0,
    placeFound = 0;
  for (const s of STARTERS)
    for (const lang of ["bg", "en"] as const) {
      const gold = (s.args[lang] ?? {}) as Record<string, unknown>;
      const e = extractEntities(s[lang]);
      const y = goldYear(gold);
      if (y !== null) {
        goldYearQuestions++;
        if (e.years.length === 1) {
          singleYear++;
          if (e.years[0] === y) singleYearCorrect++;
        }
      }
      // The hint path is scored on whether the RIGHT year is among those offered.
      if (y !== null) {
        yearHintTotal++;
        if (e.years.includes(y)) yearHintCorrect++;
      }
      const goldInd =
        typeof gold.indicator === "string"
          ? gold.indicator.toLowerCase()
          : null;
      if (goldInd) {
        if (
          e.indicators.some(
            (i) =>
              goldInd.includes(i.toLowerCase()) ||
              i.toLowerCase().includes(goldInd),
          )
        )
          indTP++;
        else indFN++;
      }
      for (const i of e.indicators)
        if (!goldInd || !goldInd.includes(i.toLowerCase())) indFP++;
      if (gold.place !== undefined) {
        placeGold++;
        if (e.mentionsPlace) placeFound++;
      }
    }
  const ratio = (n: number, d: number) => (d ? n / d : 1);
  return {
    goldYearQuestions,
    singleYear,
    singleYearCorrect,
    yearHintRecall: ratio(yearHintCorrect, yearHintTotal),
    indPrecision: ratio(indTP, indTP + indFP),
    indRecall: ratio(indTP, indTP + indFN),
    placeRecall: ratio(placeFound, placeGold),
  };
})();

describe("entity extraction is measured per slot", () => {
  it("finds EVERY year a question names (its job on the hint path)", () => {
    // Recall-oriented by design: the hint lists the years the question mentions, so a
    // comparison question is not silently reduced to one. Measured: recall 1.000.
    expect(STATS.yearHintRecall).toBe(1);
  });

  it("resolves the indicator slot precisely enough to FILL an argument", () => {
    // This slot is filled into `args`, so it is held to a precision floor. Measured
    // 2026-09-16: precision 0.799, recall 0.958 on the starter bank's own expected
    // indicators. Floors, not exact pins: the alias table grows.
    expect(STATS.indPrecision).toBeGreaterThan(0.7);
    expect(STATS.indRecall).toBeGreaterThan(0.9);
  });

  it("detects a mentioned place often enough to be a useful hint", () => {
    // Measured recall 0.763 — the cues are place-words and prepositions followed by a
    // capitalized token, and a bare proper noun with no cue is deliberately NOT
    // treated as a place ("ГЕРБ" and "Лидл" would both match). The authoritative
    // resolution is the place resolver's, not this signal.
    expect(STATS.placeRecall).toBeGreaterThan(0.7);
  });
});

describe("fillMissingArgs is safe by construction", () => {
  const none: ExtractedEntities = {
    years: [],
    indicators: [],
    parties: [],
    chains: [],
    mentionsPlace: false,
  };

  it("NEVER overwrites a value the model supplied", () => {
    // The extractor has one slot per entity; the model has the whole question. A
    // disagreement is not evidence the model is wrong.
    const filled = fillMissingArgs(
      { election: "2026_04_19", indicator: "инфлация", chain: "Лидл" },
      extractEntities("Каква е инфлацията през 2023 в Лидл?"),
    );
    expect(filled.election).toBe("2026_04_19");
    expect(filled.indicator).toBe("инфлация");
    expect(filled.chain).toBe("Лидл");
  });

  it("treats an EMPTY string as an omission", () => {
    const filled = fillMissingArgs(
      { election: "" },
      extractEntities("Каква беше активността през 2023?"),
    );
    expect(filled.election).toBe("2023");
  });

  it("fills a year only when the question names EXACTLY one", () => {
    // Measured on the starter bank: an unfiltered "take the last year mentioned" has
    // recall 1.00 but precision 0.135, because a comparison question yields several
    // candidates and only one is the argument the tool wants. With the single-year
    // rule, all 20 gold-year questions resolve to the right year and multi-year
    // questions fill nothing.
    expect(STATS.singleYear).toBe(STATS.goldYearQuestions);
    expect(STATS.singleYearCorrect).toBe(STATS.singleYear);
    expect(STATS.goldYearQuestions).toBeGreaterThan(0);
    expect(
      fillMissingArgs({}, extractEntities("Сравни 2015 и 2023")).election,
    ).toBeUndefined();
    expect(
      fillMissingArgs({}, extractEntities("Каква беше активността през 2023?"))
        .election,
    ).toBe("2023");
  });

  it("adds nothing when it detected nothing", () => {
    expect(fillMissingArgs({ a: 1 }, none)).toEqual({ a: 1 });
  });
});

describe("the prompt hint", () => {
  it("is bilingual and empty when there is nothing to say", () => {
    const e = extractEntities("Каква е инфлацията през 2023?");
    expect(renderEntityHint(e, "bg")).toContain("Разпознати обекти");
    expect(renderEntityHint(e, "bg")).toContain("2023");
    expect(renderEntityHint(e, "en")).toContain("Detected entities");
    const nothing = extractEntities("зззз");
    expect(hasEntities(nothing)).toBe(false);
    expect(renderEntityHint(nothing, "bg")).toBe("");
    expect(renderEntityHint(nothing, "en")).toBe("");
  });

  it("never states a slot it did not detect", () => {
    const e = extractEntities("Каква е инфлацията?");
    const hint = renderEntityHint(e, "en");
    expect(hint).toContain("indicator");
    expect(hint).not.toContain("years");
    expect(hint).not.toContain("chain");
  });
});
