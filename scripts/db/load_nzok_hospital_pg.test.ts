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
import { republishedMonths, type Row } from "./load_nzok_hospital_pg";

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
