import { describe, it, expect } from "vitest";
import { freshnessSentence, withheldTailCount } from "./freshness";

describe("freshnessSentence", () => {
  it("uses the Bulgarian singular for ONE withheld day", () => {
    // The modal non-zero state — any single-day reporter dip produces it. A
    // naive template renders "Последните 1 дни", and a 6-day fixture hides it.
    const s = freshnessSentence(
      { latestLabel: "9.08.2026 г.", headlineLabel: "8.08.2026 г.", tail: 1 },
      "bg",
    );
    expect(s).toContain("Последният ден е с непълен обхват");
    expect(s).not.toMatch(/Последните 1 /);
  });

  it("uses the plural for more than one", () => {
    expect(
      freshnessSentence(
        {
          latestLabel: "14.08.2026 г.",
          headlineLabel: "8.08.2026 г.",
          tail: 6,
        },
        "bg",
      ),
    ).toContain("Последните 6 дни са с непълен обхват");
  });

  it("does the same in English", () => {
    const one = freshnessSentence(
      { latestLabel: "9 Aug", headlineLabel: "8 Aug", tail: 1 },
      "en",
    );
    expect(one).toContain("The last day is under-reported");
    expect(one).not.toMatch(/last 1 day/);
    expect(
      freshnessSentence(
        { latestLabel: "14 Aug", headlineLabel: "8 Aug", tail: 6 },
        "en",
      ),
    ).toContain("The last 6 days are under-reported");
  });

  it("says nothing about withholding when nothing is withheld", () => {
    expect(
      freshnessSentence(
        {
          latestLabel: "14.08.2026 г.",
          headlineLabel: "14.08.2026 г.",
          tail: 0,
        },
        "bg",
      ),
    ).toBe("Данните стигат до 14.08.2026 г.");
    expect(
      freshnessSentence(
        { latestLabel: "14 Aug", headlineLabel: "14 Aug", tail: 0 },
        "en",
      ),
    ).toBe("Data runs to 14 Aug");
  });

  it("names the headline day, so the hero's bare date has an antecedent", () => {
    // The hero prints "числото е към 8.08.2026 г." on a page carrying five
    // numbers; this sentence is the only thing that explains it.
    expect(
      freshnessSentence(
        {
          latestLabel: "14.08.2026 г.",
          headlineLabel: "8.08.2026 г.",
          tail: 6,
        },
        "bg",
      ),
    ).toContain("кошницата е изчислена към 8.08.2026 г.");
  });

  it("does not double the full stop after a Bulgarian date", () => {
    // fmtPriceDate renders "14.08.2026 г." — with the period already there.
    const s = freshnessSentence(
      { latestLabel: "14.08.2026 г.", headlineLabel: "8.08.2026 г.", tail: 6 },
      "bg",
    );
    expect(s).not.toContain("г..");
    expect(s).toContain("г. Последните");
  });

  it("omits the clause rather than naming an empty day", () => {
    expect(
      freshnessSentence(
        { latestLabel: "14 Aug", headlineLabel: "", tail: 6 },
        "en",
      ),
    ).toBe("Data runs to 14 Aug");
  });
});

describe("withheldTailCount", () => {
  it("is the gap between the headline day and the end of the corpus", () => {
    const d = ["1", "2", "3", "4", "5"];
    expect(withheldTailCount(d, "3")).toBe(2);
    expect(withheldTailCount(d, "5")).toBe(0);
    expect(withheldTailCount(d, "1")).toBe(4);
  });

  it("claims no tail when the headline day is unknown", () => {
    // Derived independently of the headline, a mid-series withheld day would
    // make the footer assert a tail the hero's date does not support.
    expect(withheldTailCount(["1", "2", "3"], "not-in-series")).toBe(0);
    expect(withheldTailCount(["1", "2", "3"], null)).toBe(0);
    expect(withheldTailCount([], "1")).toBe(0);
  });
});
