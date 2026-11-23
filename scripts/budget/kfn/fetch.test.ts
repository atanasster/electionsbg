import { describe, expect, it } from "vitest";
import { parseArchiveLink } from "./fetch";
import { fundKey } from "./parse_kfn";

describe("parseArchiveLink", () => {
  it("normalises every suffix КФН has used to one cache name", () => {
    const base = "https://www.fsc.bg/wp-content/uploads";
    expect(
      parseArchiveLink(`${base}/2026/08/statistics_2026_q2.zip.zip`),
    ).toMatchObject({
      name: "statistics_2026_q2.zip",
      periodEnd: "2026-06-30",
    });
    expect(
      parseArchiveLink(`${base}/2025/08/statistics_2025_q2-1.zip`)?.name,
    ).toBe("statistics_2025_q2.zip");
    expect(
      parseArchiveLink(`${base}/2024/10/statistics_2024_q2_en.zip`)?.name,
    ).toBe("statistics_2024_q2.zip");
  });
  it("reads a year-only archive as the Q4 edition", () => {
    expect(
      parseArchiveLink(
        "https://www.fsc.bg/wp-content/uploads/2026/05/statistics_2025.zip",
      ),
    ).toMatchObject({ quarter: 4, periodEnd: "2025-12-31" });
  });
  it("ignores other ZIPs", () => {
    expect(
      parseArchiveLink("https://www.fsc.bg/x/annual_report.zip"),
    ).toBeNull();
  });
});

describe("fundKey", () => {
  it("joins the two spellings КФН uses for one fund", () => {
    expect(fundKey('UPF "LEV INS PENSION INSURANCE" *')).toBe(
      fundKey('UPF "LEV INS PENSION INSURANCE"*'),
    );
    expect(fundKey('  УПФ  "ДОВЕРИЕ" ')).toBe('УПФ "ДОВЕРИЕ"');
  });
});
