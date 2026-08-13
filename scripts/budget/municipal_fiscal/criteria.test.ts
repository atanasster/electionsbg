// Gates for the official-criteria reader.
//
// The one that matters: these cells are NOT booleans. МФ populates a criterion
// with its MEASURED RATIO when it is met and leaves it blank when it is not, so
// presence is the verdict. Read as да/не they yield nothing — which is how „0
// municipalities meet 3+ criteria" appeared beside 17 in a чл. 130д recovery
// procedure, a state the statute makes impossible.

import { describe, it, expect } from "vitest";
import {
  CRITERIA_COUNT,
  criterionMet,
  findCriteriaSheet,
  parseCriteriaSheet,
} from "./criteria";

const HEADER = (() => {
  const r: unknown[] = new Array(35).fill(null);
  r[1] = "Община код по ЕБК";
  r[2] = "Община";
  const titles = [
    "1. Съотношение на плащанията по общинския дълг",
    "2. Съотношение на номиналата на издадените общински гаранции",
    "3. Налични към края на годината задължения за разходи",
    "4. Налични към края на годината поети ангажименти",
    "5. Налични към края на годината просрочени задължения",
    "6. Бюджетното салдо през последните три години",
    "7. Осредненото равнището на събираемост на ДНИ и ДПрС",
  ];
  titles.forEach((t, i) => (r[24 + i] = t));
  r[31] = "Брой на критериите по чл. 130а, ал. 1 от ЗПФ, на които отговаря";
  r[33] = "Община за финансово оздравяване по чл. 130а, ал. 1";
  return r;
})();

const row = (mf: number, met: number[], count?: number, rec = false) => {
  const r: unknown[] = new Array(35).fill(null);
  r[1] = mf;
  r[2] = `Община ${mf}`;
  // The ratio itself is the payload; its value is evidence, its PRESENCE is
  // the verdict.
  for (const n of met) r[24 + n - 1] = 0.5 + n / 100;
  r[31] = count ?? met.length;
  if (rec) r[33] = 1;
  return r;
};

const parse = (rows: unknown[][], sheet = "danni 2021-2024") =>
  parseCriteriaSheet([HEADER, ...rows], sheet);

describe("criterionMet", () => {
  it("treats a PRESENT ratio as met", () => {
    expect(criterionMet(0.3365)).toBe(true);
    expect(criterionMet(1.0555)).toBe(true);
    // Zero is a real measurement and a real „met" — the cell exists.
    expect(criterionMet(0)).toBe(true);
  });

  it("treats blank as NOT met, which is what МФ means by it", () => {
    expect(criterionMet(null)).toBe(false);
    expect(criterionMet(undefined)).toBe(false);
    expect(criterionMet("")).toBe(false);
    expect(criterionMet("   ")).toBe(false);
  });

  it("still accepts a textual да, in case a release changes representation", () => {
    expect(criterionMet("да")).toBe(true);
    expect(criterionMet("ДА")).toBe(true);
  });

  it("does not treat arbitrary text as a measurement", () => {
    expect(criterionMet("n/a")).toBe(false);
  });
});

describe("findCriteriaSheet", () => {
  it("matches both the Latin and Cyrillic spellings", () => {
    expect(findCriteriaSheet(["показатели", "danni 2021-2024"])).toBe(
      "danni 2021-2024",
    );
    expect(findCriteriaSheet(["данни 2015-2018"])).toBe("данни 2015-2018");
  });

  it("returns null when the workbook has no criteria sheet", () => {
    expect(findCriteriaSheet(["показатели", "общини фин. оздр."])).toBeNull();
  });
});

describe("parseCriteriaSheet", () => {
  it("reads all seven criteria by МФ's own numbering", () => {
    expect(CRITERIA_COUNT).toBe(7);
    const out = parse([row(5112, [3, 4, 5])])!;
    expect(out.fiscalYear).toBe(2024);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      mfCode: 5112,
      met: [3, 4, 5],
      officialCount: 3,
      inRecovery: false,
    });
  });

  it("takes the anchor year from the sheet name's LAST year", () => {
    // „danni 2021-2024" describes a four-year window; the verdict is 2024's.
    expect(parse([row(5112, [1])], "danni 2021-2024")!.fiscalYear).toBe(2024);
    expect(parse([row(5112, [1])], "данни 2015-2018")!.fiscalYear).toBe(2018);
  });

  it("SKIPS a row where МФ's own count disagrees with its own columns", () => {
    // A gap means we read the wrong columns, and either half published alone
    // would be a verdict about a named município built on a misread.
    const out = parse([row(5112, [3, 4], 5), row(5601, [3, 4, 5])])!;
    expect(out.rows.map((r) => r.mfCode)).toEqual([5601]);
    expect(out.warnings.join(" ")).toMatch(/5112/);
  });

  it("reads the recovery flag, which is separate from the criteria", () => {
    // A município stays in a чл. 130д procedure after its criteria improve, so
    // the two counts legitimately differ — 2021 measured 7 meeting ≥3 against
    // 9 in a procedure.
    const out = parse([row(5112, [1], undefined, true)])!;
    expect(out.rows[0].inRecovery).toBe(true);
    expect(out.rows[0].met).toEqual([1]);
  });

  it("refuses a sheet whose header is not the criteria header", () => {
    expect(parseCriteriaSheet([[], []], "danni 2021-2024")).toBeNull();
  });

  it("refuses a sheet name carrying no year", () => {
    expect(parse([row(5112, [1])], "danni")).toBeNull();
  });

  it("ignores rows whose first column is not an МФ code", () => {
    const junk: unknown[] = new Array(35).fill(null);
    junk[1] = "Общо";
    expect(parse([junk, row(5112, [1])])!.rows).toHaveLength(1);
  });
});
