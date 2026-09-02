// `data/budget_laws.json`'s own conventions, against the committed file.
//
// The file drives WHO is credited with defending each year's budget
// (`CabinetBudgetScorecard`) and whether the izdrazhka heatmap treats a column
// as a draft. Two of its rules are carried only in prose today, and both are
// the kind that a half-edit breaks silently:
//
//   · `adopted` is the ДВ PROMULGATION date, never the НС vote date. The
//     ЗДБРБ-2026 was voted 24.07.2026 and promulgated 31.07.2026, so a
//     well-meaning "correction" to the vote date would re-resolve the crediting
//     minister with nothing failing.
//   · `adopted: null` and `note` travel together — null means "no State Budget
//     Law was in force", and `CabinetBudgetScorecard` branches on `note` to
//     credit nobody. Setting one without the other puts a caretaker year into
//     the "defended" bucket, or drops a real year out of it.
//
// Needs no database or network.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

type BudgetLawRow = {
  year: number;
  adopted: string | null;
  revisions?: string[];
  note?: "no_budget" | "interim";
};

const { budgetLaws } = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/budget_laws.json"), "utf8"),
) as { budgetLaws: BudgetLawRow[] };

describe("budget_laws.json", () => {
  it("has one row per year, in ascending order, with no gaps", () => {
    const years = budgetLaws.map((r) => r.year);
    expect(new Set(years).size).toBe(years.length);
    expect([...years].sort((a, b) => a - b)).toEqual(years);
    for (let i = 1; i < years.length; i++)
      expect(years[i] - years[i - 1], `gap before ${years[i]}`).toBe(1);
  });

  // The invariant `CabinetBudgetScorecard` branches on. A row with a `note` is
  // "no law in force"; one without must carry a date, or the year silently
  // credits nobody while claiming a law existed.
  it("pairs a null `adopted` with a `note`, in both directions", () => {
    for (const r of budgetLaws) {
      if (r.note) expect(r.adopted, `${r.year} has a note`).toBeNull();
      else expect(r.adopted, `${r.year} has no note`).not.toBeNull();
    }
  });

  it("dates every adoption as an ISO day inside its own or the prior year", () => {
    for (const r of budgetLaws) {
      if (!r.adopted) continue;
      expect(r.adopted, `${r.year}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const y = Number(r.adopted.slice(0, 4));
      // A budget is promulgated in late Y-1 (the routine case) or during Y
      // itself (a delayed adoption — 2022, 2023, 2025 and 2026 all were).
      expect([r.year - 1, r.year], `${r.year} adopted ${r.adopted}`).toContain(
        y,
      );
    }
  });

  // Pins the promulgation-not-vote convention on the row where the two dates
  // differ and are both documented, so the "correction" to 24.07 fails loudly.
  it("records the ЗДБРБ-2026 by its ДВ promulgation date, not the НС vote", () => {
    const row = budgetLaws.find((r) => r.year === 2026);
    expect(row).toBeDefined();
    expect(row!.adopted).toBe("2026-07-31");
    expect(row!.adopted).not.toBe("2026-07-24");
  });

  it("keeps every revision date inside its fiscal year", () => {
    for (const r of budgetLaws)
      for (const d of r.revisions ?? []) {
        expect(d, `${r.year} revision`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number(d.slice(0, 4)), `${r.year} revision ${d}`).toBe(r.year);
      }
  });
});
