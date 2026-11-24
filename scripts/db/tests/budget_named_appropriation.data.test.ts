// Gate for the State Budget Law's named projects (migration 208, insait-gap-v1 §4):
// only раздел I appropriates, the numbering is whole, and the INSAIT lines a reader
// asked about are there with the amounts the law prints.
import { describe, expect, it } from "vitest";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

const haveDb = await dbReachable();
const [{ n } = { n: "0" }] = haveDb
  ? await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM budget_named_appropriation",
    ).catch(() => [{ n: "0" }])
  : [{ n: "0" }];
const skip = !haveDb
  ? "Postgres unreachable"
  : n === "0"
    ? "budget_named_appropriation is empty — run pnpm run budget:ingest, then pnpm run db:load:budget-named:pg"
    : null;
const d = skip ? describe.skip : describe;
reportSkip(import.meta.url, skip);

d("budget_named_appropriation (208)", () => {
  it("never labels a reserve amount an appropriation, nor a priority one indicative", async () => {
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*)::text n FROM budget_named_appropriation_amount
        WHERE (section = 'reserve') <> (kind = 'indicative')`,
    );
    expect(Number(r.n)).toBe(0);
  });

  it("numbers every section 1..N with no gap", async () => {
    const rows = await allRows<{ fiscal_year: number; section: string }>(
      `SELECT fiscal_year, section FROM budget_named_appropriation
        GROUP BY 1, 2 HAVING max(seq) <> count(*) OR min(seq) <> 1`,
    );
    expect(rows).toEqual([]);
  });

  it("converts leva at the locked rate and euro as printed", async () => {
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*)::text n
         FROM budget_named_appropriation_amount a
         JOIN budget_named_appropriation p USING (fiscal_year, section, seq)
        WHERE abs(a.amount_eur - a.amount_native * 1000
                  / CASE p.currency WHEN 'BGN' THEN 1.95583 ELSE 1 END) > 0.01`,
    );
    expect(Number(r.n)).toBe(0);
  });

  it("carries the INSAIT computing-centre lines as the law prints them", async () => {
    const loaded = (
      await allRows<{ fiscal_year: number }>(
        "SELECT DISTINCT fiscal_year FROM budget_named_appropriation",
      )
    ).map((r) => r.fiscal_year);
    // Keyed on the law's own codes, not the title, so a reworded title cannot hide a loss.
    const expected: Record<number, [string, [number, string, number][]]> = {
      2025: ["NP-25.001-0048", [[2025, "appropriation", 3800]]],
      2026: [
        "NP-25.002-0048",
        [
          [2026, "appropriation", 3500],
          [2027, "forecast", 3500],
          [2028, "forecast", 4000],
        ],
      ],
    };
    for (const fy of [2025, 2026].filter((y) => loaded.includes(y))) {
      const [code, amounts] = expected[fy];
      const rows = await allRows<{
        title: string;
        year: number;
        kind: string;
        amount_native: number;
      }>(
        `SELECT p.title, a.year, a.kind, a.amount_native
           FROM budget_named_appropriation p
           JOIN budget_named_appropriation_amount a USING (fiscal_year, section, seq)
          WHERE p.fiscal_year = $1 AND p.section = 'priority' AND p.project_code = $2
          ORDER BY a.year`,
        [fy, code],
      );
      expect(rows.length, `${fy} ${code}`).toBeGreaterThan(0);
      expect(rows[0].title).toMatch(/INSAIT/);
      expect(rows.map((r) => [r.year, r.kind, r.amount_native])).toEqual(
        amounts,
      );
    }
  });
});

await end();
