// run() tests for judiciaryDeclarations after its persons-pg-retirement-v1 T2.6 cutover from
// fetchData("/judiciary/declarations.json") to fetchDb("judiciary-declarations") (the
// judiciary_payloads blob). Pins that the tool consumes the served blob and that a null body
// (a DB predating migration 109) degrades to the no-data envelope rather than throwing.

import { describe, it, expect, afterEach } from "vitest";
import { judiciaryDeclarations } from "./judiciary";
import { setDbFetcher, clearDataCache } from "./dataClient";
import type { ToolContext } from "./types";

const ctx = { lang: "bg" } as ToolContext;

const blob = {
  generatedAt: "2026-07-09",
  latestYear: 2025,
  totals: {
    declarations: 46528,
    magistrates: 3100,
    firstYear: 2017,
    lastYear: 2025,
  },
  years: [
    {
      year: 2025,
      declarations: 3000,
      magistrates: 2900,
      annual: 2900,
      change: 100,
    },
    {
      year: 2024,
      declarations: 5200,
      magistrates: 3050,
      annual: 5000,
      change: 200,
    },
  ],
  filingCalendar: {
    basis: "annual",
    total: 2900,
    deadline: "15.05",
    byMonth: [{ month: 5, count: 2610 }],
    byDayOfMay: [{ day: 15, count: 1200 }],
  },
  integrity: [
    {
      id: "change_late",
      bg: "Просрочени промени",
      en: "Late change filings",
      legalRef: "чл. 175в, ал. 5",
      url: "x",
      year: 2024,
      people: [
        { name: "А", position: "съдия", court: "СРС", filedLate: true },
        { name: "Б", position: "прокурор", court: "СГП", filedLate: false },
      ],
    },
    {
      id: "discrepancy",
      bg: "Несъответствия",
      en: "Discrepancies",
      legalRef: "чл. 175ж, ал. 2",
      url: "y",
      year: 2023,
      people: [
        { name: "В", position: "съдия", court: "ВКС", filedLate: false },
      ],
    },
  ],
};

describe("judiciaryDeclarations run()", () => {
  afterEach(() => clearDataCache());

  it("builds the register-index envelope from the served blob", async () => {
    setDbFetcher(async () => blob);
    const env = await judiciaryDeclarations({}, ctx);
    expect(env.tool).toBe("judiciaryDeclarations");
    expect(env.kind).toBe("table");
    // One row per integrity list (both lists, discrepancy included).
    expect(env.rows).toHaveLength(2);
    // Grounded totals come straight off the blob.
    expect(env.facts.first_year).toBe(2017);
    expect(env.facts.last_year).toBe(2025);
    // The discrepancy list is counted apart from the late-filing lists (never folded in).
    expect(env.facts.discrepancy_people).toBe(1);
    expect(env.facts.flagged_people).toBe(2); // change_late only
    expect(env.facts.filed_late).toBe(1); // of those, one carries the "(1)" footnote
    expect(env.provenance).toEqual(["db:judiciary_payloads"]);
  });

  it("degrades a null body (migration 109 absent) to the no-data envelope", async () => {
    setDbFetcher(async () => null);
    const env = await judiciaryDeclarations({}, ctx);
    expect(env.kind).toBe("scalar");
    expect(env.facts).toEqual({});
    expect(env.provenance).toEqual(["db:judiciary_payloads"]);
  });
});
