// RC-5 — the months НЗОК republishes.
//
// A month that repeats its predecessor's year-to-date with a zero month column is
// PUBLISHED as filed (§9-1 of docs/plans/nzok-hospital-parser-hardening-v1.md):
// the figures are the source's, and withholding them leaves a hole that reads as
// our defect rather than НЗОК's. What the decision requires is that it is never
// published SILENTLY — on a page showing a per-hospital € beside a date, April
// carrying March's figures is a claim about named hospitals, and a reader
// comparing the two months would conclude nothing was paid in April.
//
// So the rule that decides which months get named is the thing worth pinning, and
// it is pure — no PDF, no database.

import { describe, expect, it } from "vitest";
import {
  diffAgainstPrevious,
  loadedCoverageRow,
  refusedCoverageRow,
  republishedMonths,
  rowKey,
  type Row,
} from "./load_nzok_hospital_pg";

const row = (
  stream: Row["stream"],
  period: string,
  cumulative_eur: number,
  month_eur: number,
  reg_no = "0000000001",
): Row => ({
  reg_no,
  period,
  stream,
  eik: null,
  name: "Тест ЕООД",
  rzok_code: "01",
  rzok_name: "Благоевград",
  cumulative_eur,
  month_eur,
  currency: "EUR",
  ownership: null,
});

describe("republishedMonths", () => {
  it("names a month that repeats the previous year-to-date with no flow", () => {
    // devices 2026-04, the one instance in the cache: €31,273,942 is March's to
    // the euro and the April document's month column is zero throughout.
    const found = republishedMonths([
      row("devices", "2026-03-01", 31273942, 12196607),
      row("devices", "2026-04-01", 31273942, 0),
    ]);
    expect(found).toEqual([
      {
        stream: "devices",
        period: "2026-04-01",
        prior: "2026-03-01",
        cumulativeEur: 31273942,
      },
    ]);
  });

  it("does not name a month that merely paid nothing", () => {
    // ⚠️ A zero month total alone is NOT this fact. A month where the YTD also
    // moved is an ordinary month; a month where nothing was paid but the YTD is
    // different from the prior one is a real (if unusual) report, not a repeat.
    // Flagging it would put a warning on a figure that is simply what happened.
    expect(
      republishedMonths([
        row("devices", "2026-03-01", 31273942, 12196607),
        row("devices", "2026-04-01", 40000000, 0),
      ]),
    ).toEqual([]);
  });

  it("does not name an ordinary month, however small its flow", () => {
    expect(
      republishedMonths([
        row("devices", "2026-03-01", 31273942, 12196607),
        row("devices", "2026-04-01", 31273943, 1),
      ]),
    ).toEqual([]);
  });

  it("does not name the first month of a stream", () => {
    // Nothing to compare against. A lone zero-month file is odd but it is not a
    // REPUBLICATION, and claiming it repeats something would be inventing a prior.
    expect(
      republishedMonths([row("devices", "2026-04-01", 31273942, 0)]),
    ).toEqual([]);
  });

  it("compares within a stream, never across", () => {
    // ⚠️ The three streams are independent reports that happen to share a listing
    // page. A devices month must not be compared against the bmp month before it —
    // and since bmp is ~26× larger, a cross-stream comparison would never match by
    // accident, so this would fail silently in the useless direction: the flag
    // would simply never fire.
    expect(
      republishedMonths([
        row("bmp", "2026-04-01", 31273942, 5000),
        row("devices", "2026-04-01", 31273942, 0),
      ]),
    ).toEqual([]);
  });

  it("ignores a zero-money month entirely", () => {
    // Both totals zero is an empty report, not a republication of one.
    expect(
      republishedMonths([
        row("devices", "2026-03-01", 0, 0),
        row("devices", "2026-04-01", 0, 0),
      ]),
    ).toEqual([]);
  });

  it("does not fire across a year boundary (the year-to-date RESETS)", () => {
    // ⚠️ January's cumulative starts again from zero, so a December figure and a
    // January figure are on different bases and their equality means nothing.
    // Reviewed as "safe by accident" before this was explicit: a zero-month
    // January also has a zero cumulative, so the OTHER clause happened to exclude
    // it. Constructed here so the January guard is what does the work.
    expect(
      republishedMonths([
        row("devices", "2025-12-01", 58634450, 1000),
        row("devices", "2026-01-01", 58634450, 0),
      ]),
    ).toEqual([]);
  });

  it("compares the IMMEDIATELY preceding month, never the nearest earlier file", () => {
    // ⚠️ The devices stream has real gaps — there is no 2024-01 file. "Nearest
    // earlier" would compare 2024-02 against 2023-12, across both the gap and the
    // year-to-date reset, and the banner would name a month that is not the
    // previous one. Deleting the exact-prior lookup must fail THIS test.
    expect(
      republishedMonths([
        row("devices", "2023-12-01", 39098969, 5000),
        row("devices", "2024-02-01", 39098969, 0),
      ]),
    ).toEqual([]);
  });

  it("takes the month BEFORE, not the earliest month held", () => {
    // Pins the direction of the prior lookup. With three months in play, only the
    // immediately preceding one may match — an implementation that reached back to
    // the earliest would flag this and stay green on the simpler fixtures.
    expect(
      republishedMonths([
        row("devices", "2026-02-01", 31273942, 400),
        row("devices", "2026-03-01", 40000000, 8726058),
        row("devices", "2026-04-01", 31273942, 0),
      ]),
    ).toEqual([]);
  });

  it("requires EVERY facility's month to be zero, not merely their sum", () => {
    // ⚠️ The banner says "no payments at all in the later one". A month whose
    // per-facility flows offset to zero is a different fact and must not carry
    // that claim — negatives are real in this corpus (devices 2025-12 nets
    // −€2,127 across its rows).
    expect(
      republishedMonths([
        row("devices", "2026-03-01", 31273942, 12196607),
        row("devices", "2026-04-01", 31273942, 5000, "0000000001"),
        row("devices", "2026-04-01", 0, -5000, "0000000002"),
      ]),
    ).toEqual([]);
  });

  it("sums the rows of a period rather than reading one", () => {
    // The rule is about the month's TOTAL. A single row with a zero month inside
    // an otherwise busy month must not trip it.
    expect(
      republishedMonths([
        row("devices", "2026-03-01", 100, 100, "0000000001"),
        row("devices", "2026-04-01", 150, 50, "0000000001"),
        row("devices", "2026-04-01", 50, 0, "0000000002"),
      ]),
    ).toEqual([]);
  });
});

// §9-2 — a RESTATEMENT is invisible to the changelog, and this is what makes it
// visible. `recordIngestBatch` keys on (reg_no, period), so a TRUNCATE+reload of
// months already in `ingest_first_seen` itemises nothing: the rows are not new.
// Eleven months and €1,672,123 moved that way in the Tier 1 work — including a
// sign flip on a named Sofia clinic — and `/data/updates` would have shown silence.
describe("diffAgainstPrevious", () => {
  const prev = (key: string, cum: number, month: number) => {
    const [reg_no, period, stream] = key.split("|");
    return { reg_no, period, stream, cumulative_eur: cum, month_eur: month };
  };
  const inc = (
    reg: string,
    period: string,
    cum: number,
    month: number,
    stream: Row["stream"] = "bmp",
  ): Row => ({
    reg_no: reg,
    period,
    stream,
    eik: null,
    name: "Тест",
    rzok_code: "22",
    rzok_name: "София град",
    cumulative_eur: cum,
    month_eur: month,
    currency: "EUR",
    ownership: null,
  });

  it("counts a changed value as a restatement, not as new", () => {
    // The real case: ДКЦ Св. София published at +€5,205 for six months against a
    // true −€5,205. The row is not new, so nothing else in the pipeline sees it.
    const d = diffAgainstPrevious(
      [prev("2217134501|2023-09-01|bmp", 5205, 0)],
      [inc("2217134501", "2023-09-01", -5205, 0)],
    );
    expect(d.restatedRows).toBe(1);
    expect(d.addedRows).toBe(0);
    // ⚠️ ABSOLUTE movement: a sign flip from −5,205 to +5,205 is €10,410 of
    // restated money, which is what a reader comparing the two vintages sees.
    // Reporting the signed net would show 0 for a pair of offsetting corrections.
    expect(d.restatedEur).toBe(10410);
  });

  it("does not count an unchanged row", () => {
    const d = diffAgainstPrevious(
      [prev("0103211001|2026-07-01|bmp", 100, 10)],
      [inc("0103211001", "2026-07-01", 100, 10)],
    );
    expect(d).toEqual({
      restatedRows: 0,
      restatedMonthOnly: 0,
      restatedEur: 0,
      addedRows: 0,
      removedRows: 0,
    });
  });

  it("counts a month-only change, which moves no cumulative", () => {
    // The Tier 1 month work replaced 33 fabricated month figures with 0. The
    // cumulative did not move, so an amount-only diff would report nothing —
    // but the published month DID change and a reader would see it.
    const d = diffAgainstPrevious(
      [prev("0306253028|2026-07-01|bmp", 327640, 462)],
      [inc("0306253028", "2026-07-01", 327640, 0)],
    );
    expect(d.restatedRows).toBe(1);
    // …and counted as month-only, so a euro total alone cannot report it as
    // nothing. 33 of the Tier 1 corrections are exactly this shape.
    expect(d.restatedMonthOnly).toBe(1);
    expect(d.restatedEur).toBe(0);
  });

  it("separates added and removed rows from restated ones", () => {
    // Tier 1 recovered ДЦ ХИПОКРАТ as its own row; a re-key or a dropped facility
    // is a different event from a value moving and must not be folded in.
    const d = diffAgainstPrevious(
      [prev("0314211005|2023-01-01|bmp", 2187, 2187)],
      [
        inc("0314211005", "2023-01-01", 130, 130),
        inc("0306391032", "2023-01-01", 2187, 2187),
      ],
    );
    expect(d).toEqual({
      restatedRows: 1,
      restatedMonthOnly: 0,
      restatedEur: 2057,
      addedRows: 1,
      removedRows: 0,
    });
  });

  it("keys on the stream too — the three reports share reg numbers and periods", () => {
    // ⚠️ Without `stream` in the key, a facility's devices row would be compared
    // against its bmp row for the same month and every load would report the whole
    // corpus as restated.
    const d = diffAgainstPrevious(
      [prev("2201211067|2026-07-01|bmp", 37398035, 5445972)],
      [inc("2201211067", "2026-07-01", 2953094, 295550, "devices")],
    );
    expect(d).toEqual({
      restatedRows: 0,
      restatedMonthOnly: 0,
      restatedEur: 0,
      addedRows: 1,
      removedRows: 1,
    });
  });

  it("reports nothing on a first load", () => {
    const d = diffAgainstPrevious(
      [],
      [inc("0103211001", "2026-07-01", 100, 10)],
    );
    expect(d).toEqual({
      restatedRows: 0,
      restatedMonthOnly: 0,
      restatedEur: 0,
      addedRows: 1,
      removedRows: 0,
    });
  });
  it("ACCUMULATES across every row, not just the last of a bucket", () => {
    // ⚠️ Every fixture above puts at most one row in each bucket, so a mutation
    // replacing the accumulators with plain assignments passed all of them —
    // and the sum is the number the operator publishes. Three restatements.
    const d = diffAgainstPrevious(
      [
        prev("0000000001|2026-07-01|bmp", 100, 10),
        prev("0000000002|2026-07-01|bmp", 200, 20),
        prev("0000000003|2026-07-01|bmp", 300, 30),
      ],
      [
        inc("0000000001", "2026-07-01", 150, 10),
        inc("0000000002", "2026-07-01", 260, 20),
        inc("0000000003", "2026-07-01", 300, 30),
      ],
    );
    expect(d.restatedRows).toBe(2);
    expect(d.restatedEur).toBe(110);
  });

  it("counts every added and removed row, not one", () => {
    const d = diffAgainstPrevious(
      [
        prev("0000000001|2026-07-01|bmp", 100, 10),
        prev("0000000002|2026-07-01|bmp", 200, 20),
      ],
      [
        inc("0000000003", "2026-07-01", 300, 30),
        inc("0000000004", "2026-07-01", 400, 40),
      ],
    );
    expect(d.addedRows).toBe(2);
    expect(d.removedRows).toBe(2);
  });
});

// The key is ONE definition used by both sides of the diff. It was a SQL
// expression and a template literal, and a drift between them is the worst
// possible failure here: every row reads as added+removed, no row as restated,
// and the changelog says nothing — the exact silence the diff exists to break.
describe("rowKey", () => {
  it("includes all three identity columns", () => {
    const k = rowKey({
      reg_no: "2201211067",
      period: "2026-07-01",
      stream: "devices",
    });
    expect(k).toBe("2201211067|2026-07-01|devices");
    // Each column must move the key on its own.
    expect(k).not.toBe(
      rowKey({ reg_no: "2201211067", period: "2026-07-01", stream: "bmp" }),
    );
    expect(k).not.toBe(
      rowKey({ reg_no: "2201211067", period: "2026-06-01", stream: "devices" }),
    );
    expect(k).not.toBe(
      rowKey({ reg_no: "2201211001", period: "2026-07-01", stream: "devices" }),
    );
  });
});

// ── Tier 0: the coverage row builders.
//
// ⚠️ These assert against the EXPORTED builders. The first version of this block
// defined its own `wellFormed` helper and checked local object literals — it could
// not fail, because nothing it touched was the code under test. `collectRows` is
// not exported and cannot be, so the builders were lifted out instead; that is
// what makes the rules below checkable at all.
//
// The database is still the authority: migration 187 carries the same rules as
// CHECK constraints, and a violation there aborts the load's transaction. What
// these catch is a loader change that stops satisfying them, before it gets that far.
describe("coverage row builders", () => {
  const parsed = {
    headerFacilityCount: 382,
    totalCumulativeEur: 1326051421,
    rows: [{ cumulativeEur: 1000 }, { cumulativeEur: 2000 }],
    countMismatches: [
      { missingOrdinals: [5], extraOrdinals: [] },
      { missingOrdinals: [64, 66], extraOrdinals: [8] },
    ],
    unreconciledBlocks: ["Пловдив", "Бургас"],
    unreconciledEur: 104587839,
  };

  it("a loaded row states what was published and what went unverified", () => {
    const r = loadedCoverageRow("bmp", "2026-07-01", parsed);
    expect(r.status).toBe("loaded");
    expect(r.reason).toBeNull();
    expect(r.rows_loaded).toBe(2);
    expect(r.rows_total_eur).toBe(3000);
    expect(r.header_total_eur).toBe(1326051421);
    // Ordinals are summed across blocks AND include the extras — bmp 2026-06's
    // Русе prints 7 and numbers an 8th, so a missing-only count would report that
    // block as disagreeing about nothing.
    expect(r.count_mismatch_blocks).toBe(2);
    expect(r.count_mismatch_ordinals).toBe(4);
    expect(r.unreconciled_blocks).toBe(2);
    expect(r.unreconciled_eur).toBe(104587839);
  });

  it("an unreadable header is NULL, not a count of zero", () => {
    // ⚠️ 0 would say НЗОК published a month with no facilities worth nothing.
    const r = loadedCoverageRow("drugs", "2026-07-01", {
      ...parsed,
      headerFacilityCount: 0,
      totalCumulativeEur: 0,
    });
    expect(r.header_facility_count).toBeNull();
    expect(r.header_total_eur).toBeNull();
  });

  it("a refused row publishes nothing and still sizes the hole", () => {
    // The whole reason the refusal is a typed error: a withheld month is
    // "we are missing €31.3m of devices", not "we are missing something".
    const r = refusedCoverageRow(
      "devices",
      "2026-04-01",
      "block reconciliation failed",
      {
        headerFacilityCount: 109,
        totalCumulativeEur: 31273944,
      },
    );
    expect(r.status).toBe("refused");
    expect(r.reason).toBe("block reconciliation failed");
    expect(r.rows_loaded).toBe(0);
    expect(r.rows_total_eur).toBe(0);
    expect(r.header_total_eur).toBe(31273944);
  });

  it("a refused row leaves the verification counters UNKNOWN, not clean", () => {
    // ⚠️ 0 means "checked and clean". Nothing was checked — the refusal fired
    // first — so a 0 here would state that a withheld month's blocks reconcile.
    // Migration 187's `nzok_payment_coverage_verification_known` CHECK enforces
    // the same thing from the other side.
    const r = refusedCoverageRow(
      "bmp",
      "2023-01-01",
      "facility-count mismatch",
      {
        headerFacilityCount: 373,
        totalCumulativeEur: 101555155,
      },
    );
    expect(r.count_mismatch_blocks).toBeNull();
    expect(r.count_mismatch_ordinals).toBeNull();
    expect(r.unreconciled_blocks).toBeNull();
    expect(r.unreconciled_eur).toBeNull();
  });

  it("neither builder stamps republishes_period", () => {
    // A republication is only knowable against the month BEFORE it, which may not
    // be parsed yet — it is stamped after the whole walk. A builder that filled it
    // would be guessing from one file.
    expect(
      loadedCoverageRow("bmp", "2026-07-01", parsed).republishes_period,
    ).toBeNull();
    expect(
      refusedCoverageRow("bmp", "2026-07-01", "x", {
        headerFacilityCount: 1,
        totalCumulativeEur: 1,
      }).republishes_period,
    ).toBeNull();
  });
});
