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
});
