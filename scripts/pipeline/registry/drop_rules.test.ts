import { describe, expect, it } from "vitest";
import { coversQuarter, hasFtsYear } from "./drop_rules";

describe("coversQuarter", () => {
  const files = [
    "quarterly-reports-Q12025-Q42025-Q12026-website.xlsx",
    "1. quarterly reports Q32021-Q42021-Q32022.xlsx",
  ];

  it("reads the highest quarter whatever МФ called the file", () => {
    expect(coversQuarter(files, "2026-Q1")).toBe(true);
    expect(
      coversQuarter(["Q22025-Q42025-Q22026 za saita.xlsx"], "2026-Q2"),
    ).toBe(true);
    expect(
      coversQuarter(
        ["quarterly-reports-Q22025-Q42025-Q22026-website-16.04.2026.xlsx"],
        "2026-Q2",
      ),
    ).toBe(true);
  });

  it("is not done when only an older release is present", () => {
    expect(coversQuarter(files, "2026-Q2")).toBe(false);
    // A 2025 token mid-name must not count for 2026.
    expect(coversQuarter(["Q22026-preview-Q12025.xlsx"], "2026-Q3")).toBe(
      false,
    );
  });

  it("refuses a malformed due quarter or an empty directory", () => {
    expect(coversQuarter(files, "2026Q1")).toBe(false);
    expect(coversQuarter(files, undefined)).toBe(false);
    expect(coversQuarter([], "2026-Q1")).toBe(false);
  });
});

describe("hasFtsYear", () => {
  const files = ["2024_FTS_dataset_en.xlsx", "2025_FTS_dataset_en.xlsx"];

  it("accepts the year as a number or a numeric string", () => {
    expect(hasFtsYear(files, 2025)).toBe(true);
    expect(hasFtsYear(files, "2025")).toBe(true);
  });

  it("is not done for a year without its file, or a malformed year", () => {
    expect(hasFtsYear(files, 2026)).toBe(false);
    expect(hasFtsYear(files, "2025a")).toBe(false);
    expect(hasFtsYear(files, undefined)).toBe(false);
  });
});
