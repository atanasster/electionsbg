// The grounding gate. This is the file that decides whether a number extracted by a language
// model is allowed anywhere near the site, so its tests are adversarial by design: each one is a
// way a plausible-looking extraction could be wrong.
//
// The failure classes, in the order they matter:
//   1. A PARAPHRASE presented as a quote. The model's words, attributed to the document.
//   2. A CORRECTLY-QUOTED LEV FIGURE stored as euro. The quote check passes — that is what makes
//      this the most dangerous shape — and the number is wrong by a factor of 1.96.
//   3. A QUOTE TOO SHORT to be evidence. „5 000" occurs in any long document by accident.
//   4. AN INFERENCE with no surviving basis — an `audience` whose eligibility text was rejected.
//   5. A NORMALISER TOO EAGER, which would start accepting paraphrases in the name of tolerance.

import { describe, expect, it } from "vitest";
import {
  BGN_PER_EUR,
  currencyConflict,
  isGrounded,
  normalise,
  isGroundedIn,
  numbersIn,
  runGate,
  valueSupportedByQuote,
  type Extraction,
} from "./enrich_gate";

/** A fragment of a real „Условия за кандидатстване", including the things a PDF extractor does. */
const DOC = `
УСЛОВИЯ ЗА КАНДИДАТСТВАНЕ

3. Общ размер на безвъзмездната финансова помощ по процедурата
Общият размер на безвъзмездната финансова помощ по настоящата процедура е
127 000 000 евро.

4. Минимален и максимален размер на помощта за конкретен проект
Минималният размер на заявената безвъзмездна финансова помощ за едно проектно
предложение е 30 000 евро, а максималният – 150 000 евро.

5. Максимален интензитет на помощта
Максималният интензитет на помощта е 60 % от общата стойност на проекта.

6. Допустими кандидати
Допустими по настоящата процедура са търговци по смисъла на Търговския закон,
които са микро, малки или средни предприятия.

7. Историческа справка
По предходната процедура помощта беше в размер на 5 000 лв. за бенефициент.
`;

const claim = (value: number | string, quote: string) => ({ value, quote });

describe("isGrounded", () => {
  it("accepts a quote that is really in the document", () => {
    expect(
      isGrounded(
        "Максималният интензитет на помощта е 60 % от общата стойност",
        DOC,
      ),
    ).toBe(true);
  });

  it("REJECTS a paraphrase — the model's words, not the document's", () => {
    // The meaning is right and every fact in it is true. That is exactly why it must fail: it is
    // not what the document says, so it cannot be shown as a quotation.
    expect(
      isGrounded("Интензитетът на помощта достига 60 процента от проекта", DOC),
    ).toBe(false);
  });

  it("rejects a quote from a document it never saw", () => {
    expect(isGrounded("Максималният интензитет на помощта е 80 %", DOC)).toBe(
      false,
    );
  });

  it("tolerates the whitespace a PDF extractor introduces", () => {
    // pdftotext breaks lines mid-sentence; nobody quoting the sentence reproduces the break.
    expect(
      isGrounded(
        "Общият размер на безвъзмездната финансова помощ по настоящата процедура е 127 000 000 евро",
        DOC,
      ),
    ).toBe(true);
  });

  it("tolerates hyphenation across a line break", () => {
    const hyphenated = "Условията за кандидат-\nстване са публикувани";
    expect(
      isGrounded("Условията за кандидатстване са публикувани", hyphenated),
    ).toBe(true);
  });

  it("tolerates the dashes and quotes Word substitutes", () => {
    const doc = "Помощта е „безвъзмездна“ — до 150 000 евро за проект";
    expect(
      isGrounded('Помощта е "безвъзмездна" - до 150 000 евро за проект', doc),
    ).toBe(true);
  });

  it("REJECTS a quote too short to be evidence", () => {
    // „60 %" is in the document, and it is in every other document too.
    expect(isGrounded("60 %", DOC)).toBe(false);
    expect(isGrounded("евро", DOC)).toBe(false);
  });
});

describe("normalise is not a fuzzy matcher", () => {
  it("folds only what an extractor changes", () => {
    expect(normalise("  А  Б\nВ  ")).toBe("а б в");
    expect(normalise("кандидат-\nстване")).toBe("кандидатстване");
  });

  it("does NOT fold away words or digits", () => {
    // If any of these started matching, the gate would begin accepting paraphrases.
    expect(normalise("до 150 000 евро")).not.toBe(normalise("150 000 евро"));
    expect(normalise("не се допуска")).not.toBe(normalise("се допуска"));
    expect(normalise("30 000")).not.toBe(normalise("300 000"));
  });

  it("does NOT fold away PUNCTUATION — a decimal point is not a thousands separator", () => {
    // The mutation this catches is „normalise punctuation to whitespace too", which looks like
    // harmless tolerance and is the one edit that turns this gate into a fuzzy matcher. The
    // decisive case is numeric rather than grammatical: with punctuation folded, „150.000" and
    // „150 000" become the same string — and in Bulgarian usage the first can mean either
    // 150 thousand or 150.0, so conflating them is the magnitude error the gate exists to stop.
    expect(normalise("150.000 евро")).not.toBe(normalise("150 000 евро"));
    expect(normalise("12,5 %")).not.toBe(normalise("12 5 %"));
    // And the grammatical case: a comma is a clause boundary, not whitespace.
    expect(normalise("помощта е 60%, но не повече от 150 000")).not.toBe(
      normalise("помощта е 60% но не повече от 150 000"),
    );
  });

  it("a paraphrase differing only in punctuation is still REJECTED end to end", () => {
    // The property, not just the helper: the document writes a comma, the model drops it, and
    // that must not be presented as a quotation.
    const doc = "Помощта е 60%, но не повече от 150 000 евро за проект.";
    expect(isGrounded("Помощта е 60% но не повече от 150 000 евро", doc)).toBe(
      false,
    );
    expect(isGrounded("Помощта е 60%, но не повече от 150 000 евро", doc)).toBe(
      true,
    );
  });
});

describe("isGroundedIn — the memoised path must agree with the plain one", () => {
  it("gives the same answer as isGrounded for the same document", () => {
    // `runGate` folds the document ONCE and calls this; `isGrounded` folds per call. If the two
    // ever disagreed, the gate would behave differently from every test written against it.
    const cases = [
      "Максималният интензитет на помощта е 60 % от общата стойност",
      "Интензитетът на помощта достига 60 процента",
      "60 %",
    ];
    for (const q of cases)
      expect(isGroundedIn(q, normalise(DOC)), q).toBe(isGrounded(q, DOC));
  });
});

describe("numbersIn — every reading a Bulgarian document supports", () => {
  it("reads space-separated thousands, including NBSP and narrow NBSP", () => {
    expect(numbersIn("е 91 072 240 лв.")).toContain(91_072_240);
    expect(numbersIn("е 127\u00a0000\u00a0000 евро")).toContain(127_000_000);
    expect(numbersIn("е 30\u202f759\u202f575,00 лв.")).toContain(30_759_575);
  });

  it("reads a comma as the decimal separator — the Bulgarian convention", () => {
    expect(numbersIn("интензитет 12,5 %")).toContain(12.5);
  });

  it("returns BOTH readings of an ambiguous dot", () => {
    // „150.000" is 150 thousand to one writer and 150.0 to another, and the document does not
    // say which. Offering both is deliberate: the caller accepts if EITHER matches, so an
    // honest extraction is never rejected over a typographic convention.
    const got = numbersIn("до 150.000 евро");
    expect(got).toContain(150_000);
    expect(got).toContain(150);
  });

  it("applies a multiplier word", () => {
    expect(numbersIn("до 1,5 млн. лв.")).toContain(1_500_000);
    expect(numbersIn("2 млрд. евро")).toContain(2_000_000_000);
  });

  it("returns nothing for a sentence with no digits", () => {
    expect(numbersIn("Допустими са търговци по смисъла на закона")).toEqual([]);
  });
});

describe("valueSupportedByQuote — the CLAIM, not the citation", () => {
  it("REJECTS a fabricated number attached to a real sentence", () => {
    // The exact defect this check was added for: the quote is genuine and the figure is not.
    expect(
      valueSupportedByQuote(
        999_000_000,
        "Общият размер на безвъзмездната финансова помощ по настоящата процедура е 127 000 000 евро",
      ),
    ).toBe(false);
  });

  it("REJECTS a 100x magnitude error", () => {
    // `aid_rate_pct: 0.6` cited from „…60 %…" — the same digits, the wrong scale, and it read
    // as perfectly grounded before.
    expect(
      valueSupportedByQuote(
        0.6,
        "Максималният интензитет на помощта е 60 % от общата стойност",
      ),
    ).toBe(false);
    expect(
      valueSupportedByQuote(
        60,
        "Максималният интензитет на помощта е 60 % от общата стойност",
      ),
    ).toBe(true);
  });

  it("accepts the value the quote really states, in each real format", () => {
    expect(
      valueSupportedByQuote(127_000_000, "процедура е 127 000 000 евро"),
    ).toBe(true);
    expect(valueSupportedByQuote(12.5, "интензитет 12,5 % от стойността")).toBe(
      true,
    );
    expect(valueSupportedByQuote(1_500_000, "в размер до 1,5 млн. лв.")).toBe(
      true,
    );
  });

  it("for a STRING field, requires the phrase to appear in its own quote", () => {
    const quote = "Допустими са търговци по смисъла на Търговския закон";
    expect(
      valueSupportedByQuote("търговци по смисъла на Търговския закон", quote),
    ).toBe(true);
    // The model's own words, attributed to a sentence that does not contain them.
    expect(valueSupportedByQuote("общини и кметства", quote)).toBe(false);
    expect(valueSupportedByQuote("", quote)).toBe(false);
  });
});

describe("currencyConflict", () => {
  it("flags a lev quote", () => {
    expect(
      currencyConflict("помощта беше в размер на 5 000 лв. за бенефициент"),
    ).toBe("bgn");
    expect(currencyConflict("общо 12 000 лева")).toBe("bgn");
    expect(currencyConflict("сума в BGN")).toBe("bgn");
  });

  it("passes a euro quote", () => {
    expect(currencyConflict("максималният – 150 000 евро")).toBeNull();
    expect(currencyConflict("EUR 150 000")).toBeNull();
  });

  it("passes a CONVERSION sentence naming both", () => {
    // „5 000 лв. (2 556 евро)" is how a transitional document writes it; rejecting it would drop
    // a correctly-extractable euro figure.
    expect(currencyConflict("5 000 лв. (2 556 евро)")).toBeNull();
  });

  it("the word Evropeyskiya does NOT count as naming the euro", () => {
    // MEASURED, and the most dangerous false positive available on this corpus: every ИСУН
    // document says „Европейския социален фонд", and „евро" is a substring of it. If that
    // counted as a euro mention, `saysBgn && !saysEur` would go false and every lev budget in
    // the register would sail through. Document 005e2518 contains both in the same paragraph.
    expect(
      currencyConflict(
        "Процедурата се реализира с финансовата подкрепа на Европейския социален фонд плюс " +
          "и общият размер е 91 072 240 лв.",
      ),
    ).toBe("bgn");
    // Same shape for the adjective and the genitive.
    expect(currencyConflict("по европейски проект за 5 000 лева")).toBe("bgn");
  });

  it("passes a quote naming no currency at all", () => {
    // Common, and not by itself wrong — the surrounding document may be unambiguous.
    expect(currencyConflict("максималният размер е 150 000")).toBeNull();
  });
});

describe("runGate", () => {
  const good: Extraction = {
    budget_eur: claim(
      127_000_000,
      "Общият размер на безвъзмездната финансова помощ по настоящата процедура е 127 000 000 евро",
    ),
    aid_rate_pct: claim(
      60,
      "Максималният интензитет на помощта е 60 % от общата стойност",
    ),
    grant_min_eur: claim(
      30_000,
      "Минималният размер на заявената безвъзмездна финансова помощ за едно проектно предложение е 30 000 евро",
    ),
    grant_max_eur: claim(150_000, "а максималният – 150 000 евро"),
    beneficiaries: claim(
      "търговци по смисъла на Търговския закон",
      "Допустими по настоящата процедура са търговци по смисъла на Търговския закон",
    ),
    audience: ["business"],
  };

  it("accepts a fully grounded extraction", () => {
    const r = runGate(good, DOC);
    expect(r.rejected).toEqual([]);
    expect(r.accepted.budget_eur?.value).toBe(127_000_000);
    expect(r.accepted.aid_rate_pct?.value).toBe(60);
    expect(r.accepted.audience).toEqual(["business"]);
  });

  it("drops ONLY the ungrounded field, keeping the rest", () => {
    // A partial extraction is useful; an all-or-nothing gate would throw away four good fields
    // because of one bad one.
    const r = runGate(
      {
        ...good,
        aid_rate_pct: claim(80, "Интензитетът е 80 % според насоките"),
      },
      DOC,
    );
    expect(r.accepted.aid_rate_pct).toBeUndefined();
    expect(r.accepted.budget_eur?.value).toBe(127_000_000);
    expect(r.rejected.map((x) => x.field)).toEqual(["aid_rate_pct"]);
    expect(r.rejected[0].reason).toMatch(/not found/);
  });

  it("REJECTS a correctly-quoted LEV figure on a euro field", () => {
    // The most dangerous shape in the whole pipeline: the quote is real, the substring check
    // passes, and the number is wrong by a factor of 1.96.
    const r = runGate(
      {
        budget_eur: claim(
          5000,
          "По предходната процедура помощта беше в размер на 5 000 лв. за бенефициент",
        ),
      },
      DOC,
    );
    expect(r.accepted.budget_eur).toBeUndefined();
    expect(r.rejected[0].reason).toMatch(/levs but the field is euro/);
    expect(r.rejected[0].reason).toContain(String(BGN_PER_EUR));
  });

  it("rejects a field with no quote at all", () => {
    const r = runGate({ budget_eur: { value: 1, quote: "" } }, DOC);
    expect(r.accepted.budget_eur).toBeUndefined();
    expect(r.rejected[0].reason).toMatch(/no quote/);
  });

  it("rejects a non-numeric or negative value on a numeric field", () => {
    const r = runGate(
      {
        budget_eur: claim(
          "много" as unknown as number,
          "Общият размер на безвъзмездната финансова помощ по настоящата процедура е 127 000 000 евро",
        ),
      },
      DOC,
    );
    expect(r.accepted.budget_eur).toBeUndefined();
    expect(r.rejected[0].reason).toMatch(/non-numeric/);
  });

  it("rejects an aid rate above 100%", () => {
    // The characteristic shape of a lev amount read as a percentage.
    const r = runGate(
      {
        aid_rate_pct: claim(
          5000,
          "Максималният интензитет на помощта е 60 % от общата стойност",
        ),
      },
      DOC,
    );
    expect(r.accepted.aid_rate_pct).toBeUndefined();
    expect(r.rejected[0].reason).toMatch(/above 100%/);
  });

  it("drops BOTH bounds when min exceeds max", () => {
    // Both quotes can be real; there is no way to tell which value is the wrong one, so keeping
    // either would be a guess.
    // Each value IS stated in the quote beside it — otherwise the value binding rejects them
    // first and this stops testing the min/max rule at all. The document simply has them the
    // wrong way round, which is what a real misread looks like.
    const r = runGate(
      {
        grant_min_eur: claim(150_000, "а максималният – 150 000 евро"),
        grant_max_eur: claim(
          30_000,
          "Минималният размер на заявената безвъзмездна финансова помощ за едно проектно предложение е 30 000 евро",
        ),
      },
      DOC,
    );
    expect(r.accepted.grant_min_eur).toBeUndefined();
    expect(r.accepted.grant_max_eur).toBeUndefined();
    expect(r.rejected).toHaveLength(2);
    expect(r.rejected[0].reason).toMatch(
      /min \(150000\) exceeds max \(30000\)/,
    );
  });

  it("drops an AUDIENCE whose eligibility text did not survive", () => {
    // Otherwise the model's inference is published with no basis at all — the audience facet
    // filters the browse page, so it is a claim about who may apply.
    const r = runGate(
      {
        beneficiaries: claim(
          "МСП",
          "Допустими са само микропредприятия от селските райони",
        ),
        audience: ["business"],
      },
      DOC,
    );
    expect(r.accepted.audience).toBeUndefined();
    expect(r.rejected.map((x) => x.field)).toContain("audience");
  });

  it("every rejection carries a reason and the offending quote", () => {
    // The skill's output is a review queue for a human. A rejection with no reason is a silent
    // drop, which is the thing this whole design exists to prevent.
    const r = runGate(
      { ...good, budget_eur: claim(1, "не съществува в документа изобщо") },
      DOC,
    );
    for (const x of r.rejected) {
      expect(x.field).toBeTruthy();
      expect(x.reason.length).toBeGreaterThan(10);
      expect(typeof x.quote).toBe("string");
    }
  });

  it("REJECTS a fabricated value even when its quote is perfect", () => {
    // End to end: the substring check passes, the currency check passes, and the number is
    // still not in the sentence. Before the value binding this returned `rejected: []`.
    const r = runGate(
      {
        budget_eur: claim(
          999_000_000,
          "Общият размер на безвъзмездната финансова помощ по настоящата процедура е 127 000 000 евро",
        ),
      },
      DOC,
    );
    expect(r.accepted.budget_eur).toBeUndefined();
    expect(r.rejected[0].reason).toMatch(/does not state 999000000/);
    // The reason names what the quote DOES say, so the reviewer can see the mistake at a glance.
    expect(r.rejected[0].reason).toContain("127000000");
  });

  it("REJECTS an eligibility phrase that is not in its own quote", () => {
    const r = runGate(
      {
        beneficiaries: claim(
          "общини и кметства",
          "Допустими по настоящата процедура са търговци по смисъла на Търговския закон",
        ),
      },
      DOC,
    );
    expect(r.accepted.beneficiaries).toBeUndefined();
    expect(r.rejected[0].reason).toMatch(/does not appear in the quote/);
  });

  it("FLAGS an accepted euro field whose quote names no currency", () => {
    // Not a rejection — the document is often unambiguous — but on a corpus measured 3-of-4
    // lev-denominated, „no unit stated" is where a lev figure slips through as euro, and the
    // human promoting it has to see that rather than infer it.
    const r = runGate(
      {
        grant_max_eur: claim(150_000, "а максималният – 150 000 евро"),
        budget_eur: claim(
          127_000_000,
          "Общият размер на безвъзмездната финансова помощ по настоящата процедура е",
        ),
      },
      DOC,
    );
    expect(r.unitUnstated).toEqual([]);
    const r2 = runGate(
      {
        grant_max_eur: claim(
          30_000,
          "предложение е 30 000 евро, а максималният",
        ),
      },
      DOC,
    );
    expect(r2.unitUnstated).toEqual([]);
    const r3 = runGate(
      { grant_min_eur: claim(60, "Максималният интензитет на помощта е 60 %") },
      DOC,
    );
    expect(r3.accepted.grant_min_eur?.value).toBe(60);
    expect(r3.unitUnstated).toEqual(["grant_min_eur"]);
  });

  it("a dropped min/max pair takes its currency warning with it", () => {
    // A warning about a field that is no longer accepted sends the reviewer looking for a value
    // that is not there.
    const r = runGate(
      {
        grant_min_eur: claim(150_000, "а максималният – 150 000 евро"),
        // No currency in this span, so it earns a warning — which must then be withdrawn.
        grant_max_eur: claim(
          30_000,
          "Минималният размер на заявената безвъзмездна финансова помощ за едно проектно предложение е 30 000",
        ),
      },
      DOC,
    );
    expect(r.accepted.grant_min_eur).toBeUndefined();
    expect(r.accepted.grant_max_eur).toBeUndefined();
    expect(r.unitUnstated).toEqual([]);
  });

  it("an empty extraction is not an error", () => {
    // A document that genuinely states no figures is a normal outcome, not a failure.
    const r = runGate({}, DOC);
    expect(r.accepted).toEqual({});
    expect(r.rejected).toEqual([]);
    expect(r.unitUnstated).toEqual([]);
  });
});
