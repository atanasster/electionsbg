// Pure parser tests — no Postgres, so they can never skip.
//
// The rules here were previously asserted only from a `.data.test.ts`, which
// skips whenever the database is down. A parser that fabricates a declaration
// about a named buyer is exactly the thing that must not be gated on a service
// being reachable.

import { describe, expect, it } from "vitest";
import { isInconsistent, parseSubcontractorFacts } from "./parse";

const p = parseSubcontractorFacts;

describe("the answer must end at a non-letter", () => {
  // Both directions were live before the boundary was added: „Дата" parsed as
  // Да and „Неприложимо" as Не. A fabricated Не breaks the safety property; a
  // fabricated Да publishes a claim the buyer never made and is
  // shape-identical to a real one, so nothing downstream could catch it.
  it.each([
    ["Дата на сключване 12-май-2024"],
    ["Данни за възложителя"],
    ["Неприложимо"],
    ["Недостатъчно информация"],
  ])("refuses %s", (tail) => {
    expect(p(`участват подизпълнители ${tail}`).hasSubcontractors).toBeNull();
  });

  it("still reads the real answers", () => {
    expect(p("участват подизпълнители Да").hasSubcontractors).toBe(true);
    expect(p("участват подизпълнители Не").hasSubcontractors).toBe(false);
    // Followed by the next form label, which is the common real shape.
    expect(
      p("участват подизпълнители Не Договорът е изменян Да").hasSubcontractors,
    ).toBe(false);
  });
});

describe("all four fields come from ONE occurrence of the block", () => {
  it("does not take a count from a second, later block", () => {
    // A notice can carry the block twice — an original award and a correction.
    // Matching each label independently across the whole document could take
    // „Да" from the first and its count from the second, producing a row that
    // appears in neither.
    const twice =
      "участват подизпълнители Не " +
      "РАЗДЕЛ І: ВЪЗЛОЖИТЕЛ ".repeat(40) +
      "участват подизпълнители Да Брой подизпълнители по договора 7";
    const f = p(twice);
    expect(f.hasSubcontractors).toBe(false);
    expect(f.subcontractorCount).toBeNull();
  });
});

describe("prose is not a declaration", () => {
  it("refuses the phrase without an answer", () => {
    expect(
      p(
        "В случай че в изпълнението участват подизпълнители или трети лица, " +
          "същите трябва да отговарят на изискванията.",
      ).hasSubcontractors,
    ).toBeNull();
  });
});

describe("counts", () => {
  it("reads a count only inside the block", () => {
    expect(
      p("участват подизпълнители Да Брой подизпълнители по договора 3")
        .subcontractorCount,
    ).toBe(3);
  });

  it("does not truncate a longer run of digits into a plausible number", () => {
    // `\d{1,4}` with no boundary would read „12345" as 1234 — a wrong number
    // that looks like a right one.
    expect(
      p("участват подизпълнители Да Брой подизпълнители по договора 12345")
        .subcontractorCount,
    ).toBeNull();
  });

  it("reads the amendment fields from the same block", () => {
    const f = p(
      "участват подизпълнители Не Договорът е изменян Да Брой изменения по договора 2",
    );
    expect(f.wasAmended).toBe(true);
    expect(f.amendmentCount).toBe(2);
  });
});

describe("whitespace", () => {
  it("tolerates newlines and non-breaking spaces in the label", () => {
    expect(p("участват подизпълнители\nДа").hasSubcontractors).toBe(true);
    expect(p("участват  подизпълнители   Не").hasSubcontractors).toBe(false);
  });
});

describe("isInconsistent", () => {
  // Both halves. Buyers mis-fill the form; neither is normalised, because which
  // half is wrong is not knowable from the notice.
  it("flags Не with a count above zero", () => {
    expect(
      isInconsistent({
        hasSubcontractors: false,
        subcontractorCount: 2,
        wasAmended: null,
        amendmentCount: null,
      }),
    ).toBe(true);
  });

  it("flags Да with an explicit zero", () => {
    expect(
      isInconsistent({
        hasSubcontractors: true,
        subcontractorCount: 0,
        wasAmended: null,
        amendmentCount: null,
      }),
    ).toBe(true);
  });

  it("does not flag the ordinary shapes", () => {
    expect(
      isInconsistent({
        hasSubcontractors: false,
        subcontractorCount: null,
        wasAmended: null,
        amendmentCount: null,
      }),
    ).toBe(false);
    expect(
      isInconsistent({
        hasSubcontractors: true,
        subcontractorCount: 3,
        wasAmended: null,
        amendmentCount: null,
      }),
    ).toBe(false);
  });
});
