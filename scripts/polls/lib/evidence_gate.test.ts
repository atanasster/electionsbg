import { describe, expect, it } from "vitest";
import {
  gateFields,
  gateShares,
  gateSharesEitherDirection,
  shareSupportedByQuote,
  shareSupportedByQuoteBeforeLabel,
} from "./evidence_gate";

// The real Trend sentence measured 2026-09-09 (raw_data/polls/trend/212750).
const TR_DOC =
  "Прогресивна България остава лидер с 33,2% подкрепа сред заявилите, " +
  "че ще упражнят правото си на глас. Втори са ГЕРБ-СДС с 19,1%. Битката " +
  "за третото място остава оспорвана, като ПП-ДБ (11,2%) запазва крехка " +
  "преднина пред ДПС (10,2%).";

describe("shareSupportedByQuote", () => {
  it("accepts a real quote pairing a label with its value", () => {
    expect(
      shareSupportedByQuote(
        "Прогресивна България",
        33.2,
        "Прогресивна България остава лидер с 33,2% подкрепа",
      ),
    ).toBe(true);
  });

  it("accepts the parenthetical form", () => {
    expect(shareSupportedByQuote("ПП-ДБ", 11.2, "ПП-ДБ (11,2%)")).toBe(true);
  });

  it("refuses when the label is absent from the quote — a real number for the WRONG party", () => {
    // 19.1% is real, but it belongs to ГЕРБ-СДС, not Прогресивна България —
    // exactly the fabricated-attribution shape the gate exists to catch.
    expect(
      shareSupportedByQuote("Прогресивна България", 19.1, "ГЕРБ-СДС с 19,1%"),
    ).toBe(false);
  });

  it("refuses when the label is present but the value is not (wrong magnitude)", () => {
    expect(
      shareSupportedByQuote(
        "Прогресивна България",
        3.32, // a plausible decimal-shift error
        "Прогресивна България остава лидер с 33,2% подкрепа",
      ),
    ).toBe(false);
  });

  it("refuses a value that belongs to a DIFFERENT party named in the same compound quote — the value sits BEFORE this label", () => {
    // Real numbers, real labels, both present in the quote — but 19.1%
    // belongs to ГЕРБ-СДС, not Прогресивна България. A bare "both occur
    // somewhere" check accepts this; label-then-value must not.
    expect(
      shareSupportedByQuote(
        "Прогресивна България",
        19.1,
        "ГЕРБ-СДС получи 19,1%, а Прогресивна България получи 33,2% подкрепа сред анкетираните.",
      ),
    ).toBe(false);
  });

  it("still accepts the correct value in that same compound quote", () => {
    expect(
      shareSupportedByQuote(
        "Прогресивна България",
        33.2,
        "ГЕРБ-СДС получи 19,1%, а Прогресивна България получи 33,2% подкрепа сред анкетираните.",
      ),
    ).toBe(true);
  });

  it("with otherLabels, refuses a value that sits AFTER this label but belongs to a later-named party in the same quote", () => {
    const quote =
      "Прогресивна България с 33,2% води класацията, следвана от ГЕРБ-СДС с 19,1%.";
    expect(
      shareSupportedByQuote("Прогресивна България", 33.2, quote, ["ГЕРБ-СДС"]),
    ).toBe(true);
    expect(
      shareSupportedByQuote("Прогресивна България", 19.1, quote, ["ГЕРБ-СДС"]),
    ).toBe(false);
  });
});

describe("gateShares", () => {
  it("accepts every real share quoted correctly against the real document", () => {
    const result = gateShares(
      [
        {
          label: "Прогресивна България",
          value: 33.2,
          quote: "Прогресивна България остава лидер с 33,2% подкрепа",
        },
        { label: "ГЕРБ-СДС", value: 19.1, quote: "Втори са ГЕРБ-СДС с 19,1%" },
        { label: "ПП-ДБ", value: 11.2, quote: "ПП-ДБ (11,2%)" },
      ],
      TR_DOC,
    );
    expect(result.refused).toEqual([]);
    expect(result.accepted).toHaveLength(3);
  });

  it("refuses a quote that does not occur in the document at all", () => {
    const result = gateShares(
      [{ label: "ДПС", value: 10.2, quote: "ДПС получава рекордните 10,2%" }],
      TR_DOC,
    );
    expect(result.accepted).toEqual([]);
    expect(result.refused).toEqual([
      {
        field: "share:ДПС",
        reason: "quote not found in the extracted text",
        quote: "ДПС получава рекордните 10,2%",
      },
    ]);
  });

  it("refuses a fabricated value attached to a real, unrelated sentence — checks the CLAIM, not just the citation", () => {
    // enrich_gate.ts's own header names this exact failure shape as the
    // reason the second check exists at all.
    const result = gateShares(
      [
        {
          label: "Прогресивна България",
          value: 99,
          quote: "Прогресивна България остава лидер с 33,2% подкрепа",
        },
      ],
      TR_DOC,
    );
    expect(result.accepted).toEqual([]);
    expect(result.refused[0].reason).toContain(
      'does not state 99% beside "Прогресивна България"',
    );
  });

  it("refuses a quote shorter than the evidence floor", () => {
    const result = gateShares(
      [{ label: "X", value: 1, quote: "X 1%" }],
      "X 1% е кратка партия в документа.",
    );
    expect(result.refused[0].reason).toContain("too short");
  });

  it("refuses a claim with no quote at all", () => {
    const result = gateShares([{ label: "X", value: 1, quote: "" }], TR_DOC);
    expect(result.refused[0].reason).toBe("no quote supplied");
  });

  it("a draft with zero accepted shares is still a valid result, not a thrown error", () => {
    const result = gateShares(
      [{ label: "Никой", value: 5, quote: "" }],
      TR_DOC,
    );
    expect(result.accepted).toEqual([]);
    expect(result.refused).toHaveLength(1);
  });
});

describe("gateFields", () => {
  const PASSPORT =
    "Обем на извадката: 1004 ефективни интервюта. Период на провеждане: 13-16 април 2026 г.";

  it("accepts a numeric field (sample size) grounded and correctly stated", () => {
    const result = gateFields(
      [
        {
          field: "sampleSize",
          value: 1004,
          quote: "Обем на извадката: 1004 ефективни интервюта",
        },
      ],
      PASSPORT,
    );
    expect(result.accepted).toHaveLength(1);
  });

  it("accepts a string field (raw fieldwork text) grounded by containment", () => {
    const result = gateFields(
      [
        {
          field: "fieldworkRaw",
          value: "13-16 април 2026 г.",
          quote: "Период на провеждане: 13-16 април 2026 г.",
        },
      ],
      PASSPORT,
    );
    expect(result.accepted).toHaveLength(1);
  });

  it("refuses a numeric field whose quote states a different number", () => {
    const result = gateFields(
      [
        {
          field: "sampleSize",
          value: 2000,
          quote: "Обем на извадката: 1004 ефективни интервюта",
        },
      ],
      PASSPORT,
    );
    expect(result.accepted).toEqual([]);
    expect(result.refused[0].reason).toContain("does not state 2000");
  });

  it("refuses a string field whose stated text does not appear in its own quote", () => {
    const result = gateFields(
      [
        {
          field: "fieldworkRaw",
          value: "1-5 май 2026 г.",
          quote: "Период на провеждане: 13-16 април 2026 г.",
        },
      ],
      PASSPORT,
    );
    expect(result.accepted).toEqual([]);
    expect(result.refused).toHaveLength(1);
  });
});

// The real 2016 Trend sentence measured 2026-09-10
// (raw_data/polls/trend/a63a09b7af8f2976) — the shape
// `shareSupportedByQuote` cannot verify at all, since the value sits
// BEFORE the label rather than after it.
const TR_BEFORE_LABEL_QUOTE =
  "След нея с 24% се нарежда подкрепеният от БСП претендент Румен Радев";

describe("shareSupportedByQuoteBeforeLabel", () => {
  it("accepts a real quote stating the value BEFORE the label", () => {
    expect(
      shareSupportedByQuoteBeforeLabel(
        "Румен Радев",
        24,
        TR_BEFORE_LABEL_QUOTE,
      ),
    ).toBe(true);
  });

  it("refuses when the label is absent from the quote", () => {
    expect(
      shareSupportedByQuoteBeforeLabel(
        "Цецка Цачева",
        24,
        TR_BEFORE_LABEL_QUOTE,
      ),
    ).toBe(false);
  });

  it("refuses when no number behind the label matches the claimed value", () => {
    expect(
      shareSupportedByQuoteBeforeLabel(
        "Румен Радев",
        27.3,
        TR_BEFORE_LABEL_QUOTE,
      ),
    ).toBe(false);
  });

  it("does not reach back past an `otherLabels` entry that ALSO uses the before-label shape", () => {
    const twoCandidateQuote =
      "с 27,3% е Цецка Цачева. След нея с 24% се нарежда Румен Радев.";
    // Цачева's own 27,3% must not be read as Radev's number just because
    // it is somewhere earlier in the same combined quote.
    expect(
      shareSupportedByQuoteBeforeLabel("Румен Радев", 27.3, twoCandidateQuote, [
        "Цецка Цачева",
      ]),
    ).toBe(false);
    expect(
      shareSupportedByQuoteBeforeLabel("Румен Радев", 24, twoCandidateQuote, [
        "Цецка Цачева",
      ]),
    ).toBe(true);
  });
});

describe("gateSharesEitherDirection", () => {
  it("accepts a claim in the FORWARD shape (same as gateShares)", () => {
    const result = gateSharesEitherDirection(
      [
        {
          label: "Прогресивна България",
          value: 33.2,
          quote: "Прогресивна България остава лидер с 33,2% подкрепа",
        },
      ],
      TR_DOC,
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.refused).toEqual([]);
  });

  it("accepts a claim in the BACKWARD shape, which gateShares alone refuses", () => {
    const claim = {
      label: "Румен Радев",
      value: 24,
      quote: TR_BEFORE_LABEL_QUOTE,
    };
    expect(gateShares([claim], TR_BEFORE_LABEL_QUOTE).accepted).toEqual([]);
    const either = gateSharesEitherDirection([claim], TR_BEFORE_LABEL_QUOTE);
    expect(either.accepted).toEqual([claim]);
    expect(either.refused).toEqual([]);
  });

  it("still refuses a claim whose quote supports NEITHER direction", () => {
    const result = gateSharesEitherDirection(
      [
        {
          label: "Румен Радев",
          value: 99,
          quote: TR_BEFORE_LABEL_QUOTE,
        },
      ],
      TR_BEFORE_LABEL_QUOTE,
    );
    expect(result.accepted).toEqual([]);
    expect(result.refused[0].reason).toContain(
      'does not state 99% beside "Румен Радев"',
    );
  });

  it("still refuses on ungrounded/too-short quotes exactly like gateShares", () => {
    const result = gateSharesEitherDirection(
      [{ label: "Румен Радев", value: 24, quote: "не е в текста" }],
      TR_BEFORE_LABEL_QUOTE,
    );
    expect(result.accepted).toEqual([]);
    expect(result.refused[0].reason).toBe(
      "quote not found in the extracted text",
    );
  });
});
