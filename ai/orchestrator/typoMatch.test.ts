import { describe, expect, it } from "vitest";
import { typoMatch, typoMatches, typoTokens } from "./typoMatch";
import { evaluateNonAi, NON_AI_CASES } from "../tests/nonAiEval";

// Free harness for the typo / alternate-word matcher (plan C5).
//
// It pins two properties that pull against each other:
//
//   RECALL on a curated set of surface variants (misspellings, diminutives,
//   inflections, synonyms), and
//   PRECISION as a hard zero: on every corpus question the deterministic router
//   already answers correctly, this matcher must not fire at all. It is consulted
//   exactly where the router declined, so a wrong suggestion displaces the
//   clarification it was supposed to improve.
//
// Getting precision to zero cost recall, and the notes below record what was
// measured and rejected rather than pretending the trade did not happen.

// A surface variant and the tools that legitimately answer it. Sibling tools are
// listed together where the corpus itself is ambiguous (nzokDrugs vs
// nzokDrugSavings), because the caller renders a 3-option chooser and needs the
// right tool IN the list — not a single winner.
const VARIANTS: [string, string[]][] = [
  ["Каква е инфлацята?", ["macroIndicator"]], // transposition
  ["Къде е най-скъпата кошничка?", ["priceRanking", "basketAffordability"]], // diminutive
  ["Колко похарчи НЗОК за лекрства?", ["nzokDrugs", "nzokDrugSavings"]], // transposition
  ["Каква е избирателната активнос?", ["turnout", "turnoutSeries"]], // dropped ending
  ["Колко е безработноста?", ["rankPlaces", "regionIndicator"]], // dropped ending
];
// Measured 2026-09-16. Only TWO variants resolve at rank 1: a one- or two-token
// question is genuinely ambiguous between sibling tools, which is what the
// multi-tool gold lists above admit. Every variant resolves within the 3-option
// chooser cap the caller uses.
const TOP1: Record<string, string> = {
  "Каква е инфлацята?": "macroIndicator",
  "Колко похарчи НЗОК за лекрства?": "nzokDrugSavings",
};

describe("recall on surface variants", () => {
  it("puts a correct tool in the top 3 for every variant", () => {
    const missed = VARIANTS.filter(
      ([q, golds]) => !typoMatches(q, 3).some((h) => golds.includes(h.tool)),
    );
    expect(missed.map(([q]) => q)).toEqual([]);
  });

  it("resolves the two unambiguous variants at rank 1", () => {
    for (const [q, tool] of Object.entries(TOP1))
      expect(typoMatch(q)?.tool, q).toBe(tool);
  });

  it("records the correction it made, and reaches a key through one further typo", () => {
    expect(typoMatch("Каква е инфлацята?")?.corrections[0]).toEqual({
      from: "inflatsyata",
      to: "inflatsiya",
    });
    // The bounded Damerau-Levenshtein path: this token is one DELETION from the
    // ALTERNATES key "inflatsyata" and is not itself a key. Without that branch the
    // edit bound would be dead code, and the module would only ever handle exactly
    // the spellings someone typed into the table.
    const viaEdit = typoMatches("Каква е инфлцята?", 3);
    expect(viaEdit.length).toBeGreaterThan(0);
    expect(viaEdit[0].corrections[0].to).toBe("inflatsiya");
  });

  it("returns the correction alongside the suggestion, so it is explainable", () => {
    for (const [q] of VARIANTS)
      for (const h of typoMatches(q, 3))
        for (const c of h.corrections) {
          expect(typoTokens(q)).toContain(c.from);
          expect(c.to).not.toBe(c.from);
        }
  });

  it("reads a decomposed (NFD) question the same as a composed one", () => {
    // translitKey normalizes NFC first; without it a decomposed `й` splits the
    // token and the correction path is lost.
    const nfc = "Каква е избирателната активнос?";
    expect(typoTokens(nfc.normalize("NFD"))).toEqual(typoTokens(nfc));
    expect(typoMatches(nfc.normalize("NFD"), 3)).toEqual(typoMatches(nfc, 3));
  });
});

describe("precision is a hard zero, because the caller consults it where the router declined", () => {
  it("counts the corpus it is asserting over, so the zeros cannot go vacuous", () => {
    // Recorded 2026-09-16. Without these denominators, a shrunken corpus or a
    // broken `callOk` would make every zero below pass while pinning nothing.
    let answered = 0,
      gaps = 0,
      fired = 0,
      firedOnGaps = 0;
    for (const c of NON_AI_CASES)
      for (const lang of ["en", "bg"] as const) {
        const r = evaluateNonAi(c, lang);
        if (r.callOk && r.selected) {
          answered++;
          if (typoMatches(c[lang], 5).length) fired++;
        } else if (!r.callOk) {
          gaps++;
          if (typoMatches(c[lang], 5).length) firedOnGaps++;
        }
      }
    expect(answered).toBe(1444);
    expect(gaps).toBe(207);
    // The property asserted is the STRONGER "never fires at all" on a question the
    // router already answers. That is what a correctly spelled question deserves:
    // its tokens are already vocabulary, so there is nothing to correct, and the
    // matcher stays out of the way.
    expect(fired).toBe(0);
    // The 207 known gaps are COVERAGE gaps (correctly spelled questions the keyword
    // rules have no branch for) and confident mis-routes. A surface matcher fixes
    // neither, and this pins that it does not claim to.
    expect(firedOnGaps).toBe(0);
  });

  it("stays silent on a question whose intent no tool in this registry answers", () => {
    // The pay synonyms were removed after measurement: the only token they reached
    // was `zaplatata` in noiPensionSeries, a PENSION-versus-wage tool, so a
    // question about a mayor's remuneration came back as a pension series. No tool
    // answers mayoral pay, so correcting nothing is the honest behaviour.
    for (const q of [
      "Какво е възнаграждението на кмета?",
      "Какво е заплатата на кмета?",
    ])
      expect(typoMatches(q, 5), q).toEqual([]);
  });

  it("does not attach a correction to an unrelated tool through a short prefix", () => {
    // `tsena` prefix-matched a dozen tools (gas, electricity, medicines); that
    // entry was removed for this reason. Pin the concrete spill so it cannot return.
    expect(
      typoMatches("Каква е цената на тока?", 5).map((h) => h.tool),
    ).not.toContain("nzokDrugMolecule");
    expect(
      typoMatches("Каква е цената на тока?", 5).map((h) => h.tool),
    ).not.toContain("gasPrices");
  });

  it("stays silent on correctly spelled questions and on no-evidence input", () => {
    for (const q of [
      "",
      "   ",
      "?!",
      "Колко гласа взе ГЕРБ?",
      "Какъв е държавният бюджет?",
      "Кой е кметът на Пловдив?",
    ])
      expect(typoMatches(q, 5), q).toEqual([]);
  });

  it("does not capture the boundary traps the domain scope guards", () => {
    for (const [q, forbidden] of [
      ["Министерският съвет колко похарчи?", "localCouncil"],
      ["Какво съдържа бюджетът?", "regionHistory"],
    ] as const)
      expect(typoMatches(q, 5).map((h) => h.tool)).not.toContain(forbidden);
  });

  it("is deterministic and order-stable", () => {
    for (const [q] of VARIANTS)
      expect(typoMatches(q, 5)).toEqual(typoMatches(q, 5));
    // Ties break on tool name, not on Map insertion order — asserted only between
    // entries that actually TIE on similarity, since the ranking itself is by
    // resemblance and is not alphabetical.
    const m = typoMatches("Колко е безработноста?", 5);
    for (let i = 1; i < m.length; i++)
      if (m[i].score === m[i - 1].score)
        expect(m[i - 1].tool < m[i].tool).toBe(true);
  });
});
