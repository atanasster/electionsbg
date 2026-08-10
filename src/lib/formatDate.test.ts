import { describe, expect, it } from "vitest";
import { formatDate } from "./formatDate";

describe("formatDate", () => {
  it("renders a date-only value as ITS OWN day, west of Greenwich too", () => {
    // The regression this guards: `new Date("2021-04-15")` is UTC midnight, so formatting
    // in the viewer's zone printed 14 April under any negative offset (found under
    // America/New_York). A date-only value has no time of day to shift.
    expect(formatDate("2021-04-15", "bg")).toContain("15");
    expect(formatDate("2021-04-15", "en")).toContain("15");
    // Jan 1 is the sharpest case — a westward shift moves the YEAR as well as the day.
    expect(formatDate("2021-01-01", "en")).toContain("2021");
    expect(formatDate("2021-01-01", "en")).not.toContain("2020");
  });

  it("localizes the same day two ways", () => {
    const bg = formatDate("2023-10-29", "bg");
    const en = formatDate("2023-10-29", "en");
    expect(bg).not.toBe(en);
    expect(bg).toContain("29");
    expect(en).toContain("29");
  });

  it("falls back to the raw string rather than printing Invalid Date", () => {
    expect(formatDate("not-a-date", "bg")).toBe("not-a-date");
    expect(formatDate("", "en")).toBe("");
  });

  it("leaves a real instant in the reader's own zone", () => {
    // Scoped to the date-only shape on purpose: for an instant, the viewer's zone IS the
    // right answer, so this must not acquire the UTC pin. Asserted via the offset the test
    // env actually runs under rather than a hard-coded day.
    const iso = "2021-04-15T02:30:00Z";
    const local = new Date(iso).getDate();
    expect(formatDate(iso, "en")).toContain(String(local));
  });
});
