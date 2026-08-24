// The decisions validator is the contract three modules share — the crawler
// (which must fail on a rejection spike), the Postgres loader (which must refuse
// to merge a short build over the live table) and the matcher (which must never
// see a row with a missing or wrong date). It is pure, so it is testable without
// a browser, a network or a database.
//
// The cases below are the failures actually observed in the 2026-07-04 corpus,
// not invented ones — see kzk_decisions_store.ts for the column-shift signature.

import { describe, it, expect } from "vitest";
import {
  validateDecisions,
  summarizeRejections,
  ACT_NO_RE,
  ACT_NO_PARTS_RE,
  countActNumbers,
  countRecordHeaders,
  type KzkDecision,
} from "./kzk_decisions_store";

const ok: KzkDecision = {
  no: "АКТ-608-25.06.2026",
  ddate: "2026-06-25",
  pron: "оставя жалбата без уважение",
  kzk: "КЗК/417/2026",
  init: '"А" ЕООД; "Б" АД',
  resp: "ОБЩИНА АНТОНОВО",
};

describe("validateDecisions", () => {
  it("keeps a well-formed row and preserves the ';'-joined initiators verbatim", () => {
    const { clean, rejected } = validateDecisions([ok]);
    expect(rejected).toHaveLength(0);
    // Splitting the party list is the MATCHER's job — the store records what the
    // register printed, so a future parse change cannot rewrite history.
    expect(clean[0].init).toBe('"А" ЕООД; "Б" АД');
  });

  it("rejects the observed column shift (act text in `no`, blank pron/ddate)", () => {
    const shifted: KzkDecision = {
      no: "F788088/26.12.2025 г. на заместник-кмета на община Пловдив… - ОБЩИНА ПЛОВДИВ; Отменя…",
      pron: "",
      ddate: "",
    };
    const { clean, rejected } = validateDecisions([shifted]);
    expect(clean).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/column shift/);
  });

  it("rejects an empty act number, a non-ISO date, and a duplicate — keeping the first", () => {
    const { clean, rejected } = validateDecisions([
      { no: "", ddate: "2026-06-25" },
      { no: "АКТ-1-01.01.2026", ddate: "01.01.2026" },
      ok,
      { ...ok, resp: "ДРУГА ОБЩИНА" },
    ]);
    expect(clean).toHaveLength(1);
    expect(clean[0].resp).toBe("ОБЩИНА АНТОНОВО");
    expect(rejected).toHaveLength(3);
  });

  it("trims the key fields so a padded act number is not a distinct row", () => {
    const { clean } = validateDecisions([
      { ...ok, no: "  АКТ-608-25.06.2026 ", ddate: " 2026-06-25 " },
    ]);
    expect(clean[0].no).toBe("АКТ-608-25.06.2026");
    expect(clean[0].ddate).toBe("2026-06-25");
  });

  it("rejects a date that is ISO-SHAPED but not a real calendar date", () => {
    const { clean, rejected } = validateDecisions([
      { no: "АКТ-1-45.13.2026", ddate: "2026-13-45" },
    ]);
    expect(clean).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/unreal|not ISO/);
  });

  it("rejects a row whose ddate disagrees with the act number's own date", () => {
    // The shift signature that shape checks alone cannot see: both fields are
    // populated and well-formed, but they describe different days. Left in, this
    // joins the wrong appeal and can drag the freshness gate to a date КЗК never
    // published.
    const { clean, rejected } = validateDecisions([
      { ...ok, no: "АКТ-608-25.06.2026", ddate: "2026-06-24" },
    ]);
    expect(clean).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/disagrees with the act number/);
  });

  it("summarizes rejections by reason, most frequent first", () => {
    const { rejected } = validateDecisions([
      { no: "x", ddate: "2026-01-01" },
      { no: "y", ddate: "2026-01-01" },
      { no: "", ddate: "2026-01-01" },
    ]);
    const summary = summarizeRejections(rejected);
    expect(summary[0].count).toBe(2);
    expect(summary[0].reason).toMatch(/column shift/);
    expect(summary.reduce((a, s) => a + s.count, 0)).toBe(3);
  });

  it("is a no-op on an empty corpus rather than throwing", () => {
    expect(validateDecisions([])).toEqual({ clean: [], rejected: [] });
  });
});

describe("ACT_NO_RE", () => {
  it("accepts the register's format and rejects near-misses", () => {
    expect(ACT_NO_RE.test("АКТ-608-25.06.2026")).toBe(true);
    expect(ACT_NO_RE.test("АКТ-1-01.01.2020")).toBe(true);
    // Latin "AKT" — the Cyrillic prefix is what the register prints.
    expect(ACT_NO_RE.test("AKT-608-25.06.2026")).toBe(false);
    expect(ACT_NO_RE.test("АКТ-608-2026-06-25")).toBe(false);
    expect(ACT_NO_RE.test("РОП-608-25.06.2026")).toBe(false);
  });

  // ACT_NO_SRC is the one definition; ACT_NO_PARTS_RE (used by validateDecisions
  // for its date cross-check) stays hand-written because it needs capture groups.
  // That is the one copy the consolidation could not remove, so it gets this
  // agreement test instead: a drift between them means validateDecisions rejects
  // a shape scripts/db/tests/kzk_decisions.data.test.ts — which asserts stored
  // rows against ACT_NO_RE — would accept, or the reverse.
  it("ACT_NO_PARTS_RE accepts exactly what ACT_NO_RE accepts", () => {
    for (const s of [
      "АКТ-608-25.06.2026",
      "АКТ-1-01.01.2020",
      "AKT-608-25.06.2026",
      "АКТ-608-2026-06-25",
      "АКТ-608-3.06.2026",
      "РОП-608-25.06.2026",
      "",
    ])
      expect(ACT_NO_PARTS_RE.test(s)).toBe(ACT_NO_RE.test(s));
  });
});

// The PURE assertions on the two page counters live here, beside the functions.
// The JOINT invariant — "a parse yields no more records than the page names
// acts" — lives in kzk_decisions.test.ts, because it constrains the parser.
describe("countActNumbers / countRecordHeaders", () => {
  const PAGE = [
    "1     Решение № АКТ-100-01.02.2026",
    "Ответник(ници): ОБЩИНА А",
    "2     Определение № АКТ-101-03.02.2026",
    "Ответник(ници): ОБЩИНА Б",
  ].join("\n");

  it("counts the act numbers the page names", () => {
    expect(countActNumbers(PAGE)).toBe(2);
  });

  it("counts DISTINCT acts, so a repeated token cannot inflate the ceiling", () => {
    // A back-reference or a duplicated header cell would otherwise raise the
    // count with no record behind it and loosen the invariant in silence.
    const repeated = `${PAGE}\nПреписка по АКТ-100-01.02.2026`;
    expect(countActNumbers(repeated)).toBe(2);
  });

  it("returns 0 for a page with no records rather than throwing", () => {
    expect(countActNumbers("Намерени са общо 0 акта")).toBe(0);
    expect(countRecordHeaders("Намерени са общо 0 акта")).toBe(0);
    expect(countActNumbers("")).toBe(0);
    expect(countRecordHeaders("")).toBe(0);
  });

  it("counts headers by the header WORD, independently of the act-number shape", () => {
    // The property that makes it a tripwire for a drifting act number: the
    // middle act is unpadded and matches neither ACT_NO_SRC nor the boundary,
    // yet its header is still visible here.
    const drifted = PAGE.replace("АКТ-101-03.02.2026", "АКТ-101-3.02.2026");
    expect(countActNumbers(drifted)).toBe(1);
    expect(countRecordHeaders(drifted)).toBe(2);
  });

  it("counts a line-start quotation as a header — it is an upper bound", () => {
    const quoted = `${PAGE}\nРешение № РД-25/10.01.2026 г. на кмета`;
    expect(countRecordHeaders(quoted)).toBe(3);
    expect(countActNumbers(quoted)).toBe(2);
  });

  it("does not count an inline mention as a header", () => {
    expect(
      countRecordHeaders("отменя обжалваното Решение № РД-25 на кмета"),
    ).toBe(0);
  });
});
