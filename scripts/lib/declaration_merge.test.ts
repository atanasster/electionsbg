// The merge that decides whether an ingest run PRESERVES a declarant's history
// or replaces it. The MP leg lacked it and a single-year run deleted the
// 2021-2024 filings of 244 MPs, so the multi-year and non-overlap cases below
// are the point of the file, not edge cases.
//
// Pure functions — `node` Vitest project, no network, no filesystem.

import { describe, expect, it } from "vitest";
import { folderFromSourceUrl, mergeDeclarations } from "./declaration_merge";

const url = (year: number | string, id: string) =>
  `https://register.cacbg.bg/${year}/${id}.xml`;

type Decl = {
  sourceUrl: string;
  declarationYear: number;
  fiscalYear?: number | null;
  filedAt?: string | null;
  entryNumber?: string | null;
  declarationType?: string | null;
};

const decl = (
  year: number | string,
  id: string,
  over: Partial<Decl> = {},
): Decl => ({
  sourceUrl: url(year, id),
  declarationYear:
    typeof year === "number" ? year : Number(String(year).slice(0, 4)),
  fiscalYear: null,
  filedAt: null,
  entryNumber: id,
  declarationType: "Annualy",
  ...over,
});

describe("folderFromSourceUrl", () => {
  it("reads the register folder a declaration came from, verbatim", () => {
    expect(folderFromSourceUrl(url(2023, "ABC"))).toBe("2023");
  });

  // The whole point of keying on the segment: 2021_nc IS the MP 2021 cohort
  // (there is no plain /2021/), and Number("2021_nc") is NaN.
  it("returns a suffixed folder as itself, not as a number", () => {
    expect(folderFromSourceUrl(url("2021_nc", "ABC"))).toBe("2021_nc");
    expect(folderFromSourceUrl(url("2024f1", "ABC"))).toBe("2024f1");
  });

  it("rejects a foreign host", () => {
    expect(folderFromSourceUrl("https://example.com/2023/x.xml")).toBeNull();
  });
});

describe("mergeDeclarations", () => {
  // THE regression: a run that fetched only 2025 must not take 2021-2024 with it.
  it("keeps years the run did not target", () => {
    const existing = [decl(2024, "a"), decl(2022, "b"), decl(2021, "c")];
    const merged = mergeDeclarations(existing, [decl(2025, "d")], "2025");
    expect(merged.map((d) => d.declarationYear).sort()).toEqual([
      2021, 2022, 2024, 2025,
    ]);
  });

  it("replaces exactly the targeted year, so corrections and removals land", () => {
    const existing = [
      decl(2025, "old1"),
      decl(2025, "old2"),
      decl(2024, "keep"),
    ];
    const merged = mergeDeclarations(existing, [decl(2025, "new")], "2025");
    expect(merged.map((d) => d.entryNumber).sort()).toEqual(["keep", "new"]);
  });

  // The MP ingest accepts DECL_YEARS as a list, so a run can own several years.
  it("replaces every targeted year when given a list", () => {
    const existing = [
      decl(2025, "old25"),
      decl(2024, "old24"),
      decl(2022, "keep22"),
    ];
    const merged = mergeDeclarations(
      existing,
      [decl(2025, "new25"), decl(2024, "new24")],
      ["2025", "2024"],
    );
    expect(merged.map((d) => d.entryNumber).sort()).toEqual([
      "keep22",
      "new24",
      "new25",
    ]);
  });

  it("is idempotent — re-running the same year reproduces the same set", () => {
    const existing = [decl(2025, "a"), decl(2024, "b")];
    const once = mergeDeclarations(existing, [decl(2025, "a")], "2025");
    const twice = mergeDeclarations(once, [decl(2025, "a")], "2025");
    expect(twice).toEqual(once);
  });

  it("does not double a row whose URL carries no parseable folder year", () => {
    const odd = { ...decl(2025, "x"), sourceUrl: "https://elsewhere/x.xml" };
    const merged = mergeDeclarations([odd], [odd], "2025");
    expect(merged).toHaveLength(1);
  });

  // A run targeting the bare folder "2021" does not own "2021_nc" rows.
  it("keeps a suffixed-folder row when a bare-year run targets its year", () => {
    const existing = [decl("2021_nc", "nc")];
    const merged = mergeDeclarations(existing, [decl(2021, "plain")], "2021");
    expect(merged.map((d) => d.entryNumber).sort()).toEqual(["nc", "plain"]);
  });

  // ...and a run that DOES target "2021_nc" replaces exactly those rows. This is
  // the MP 2021 cohort, so getting it wrong meant corrections never landed.
  it("replaces suffixed-folder rows when the run targets that folder", () => {
    const existing = [decl("2021_nc", "old"), decl(2022, "keep")];
    const merged = mergeDeclarations(
      existing,
      [decl("2021_nc", "new")],
      "2021_nc",
    );
    expect(merged.map((d) => d.entryNumber).sort()).toEqual(["keep", "new"]);
  });

  // Ownership is the FOLDER, never the parsed declarationYear. A 2025-folder
  // row can carry declarationYear 2026 (an annual for fiscal 2025); keying on
  // the parsed year would leave it behind on a 2025 re-run.
  it("keys ownership on the folder, not the parsed declarationYear", () => {
    const odd = decl(2025, "annual2026", { declarationYear: 2026 });
    const merged = mergeDeclarations([odd], [decl(2025, "fresh")], "2025");
    expect(merged.map((d) => d.entryNumber)).toEqual(["fresh"]);
  });

  // Upstream does list one declaration twice; a merge that cannot heal that
  // leaves the duplicate in the file forever.
  it("dedupes a declaration repeated within the incoming set", () => {
    const dup = decl(2025, "same");
    const merged = mergeDeclarations([], [dup, { ...dup }], "2025");
    expect(merged).toHaveLength(1);
  });

  it("returns the merged history newest-first", () => {
    const merged = mergeDeclarations(
      [decl(2022, "b"), decl(2024, "a")],
      [decl(2025, "c")],
      "2025",
    );
    expect(merged.map((d) => d.declarationYear)).toEqual([2025, 2024, 2022]);
  });

  it("handles an empty existing history", () => {
    expect(mergeDeclarations([], [decl(2025, "a")], "2025")).toHaveLength(1);
  });

  // A year with nothing to write must not silently wipe that year — the caller
  // only reaches the merge for declarants the run actually saw.
  it("clears a targeted year when the run returns nothing for it", () => {
    const merged = mergeDeclarations(
      [decl(2025, "gone"), decl(2024, "keep")],
      [],
      "2025",
    );
    expect(merged.map((d) => d.entryNumber)).toEqual(["keep"]);
  });
});
