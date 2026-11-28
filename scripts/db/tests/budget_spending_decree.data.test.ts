// Gate for the ПМС spending-decree corpus (migration 209): every
// decree carries its money in the stated currency at the locked rate, dates are
// coherent, and the whole-word search agrees with the table it reads.
import { describe, expect, it } from "vitest";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

const haveDb = await dbReachable();
const [{ n } = { n: "0" }] = haveDb
  ? await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM budget_spending_decree",
    ).catch(() => [{ n: "0" }])
  : [{ n: "0" }];
const skip = !haveDb
  ? "Postgres unreachable"
  : n === "0"
    ? "budget_spending_decree is empty — run pnpm run budget:dv-decrees --from-id <id>, then pnpm run db:load:budget-decrees:pg"
    : null;
const d = skip ? describe.skip : describe;
reportSkip(import.meta.url, skip);

d("budget_spending_decree (209)", () => {
  it("converts leva at the locked rate and keeps euro as printed", async () => {
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*)::text n FROM budget_spending_decree_clause
        WHERE abs(amount_eur - amount_native
                  / CASE currency WHEN 'BGN' THEN 1.95583 ELSE 1 END) > 0.01`,
    );
    expect(Number(r.n)).toBe(0);
  });

  it("dates a decree no later than the issue that promulgated it", async () => {
    const [r] = await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM budget_spending_decree WHERE decree_date > issue_date",
    );
    expect(Number(r.n)).toBe(0);
  });

  it("gives most decrees an amount — a missing one means the wording moved", async () => {
    const [r] = await allRows<{ with_amount: string; total: string }>(
      `SELECT count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM budget_spending_decree_clause c WHERE c.id_mat = d.id_mat
              ))::text with_amount,
              count(*)::text total
         FROM budget_spending_decree d`,
    );
    expect(Number(r.with_amount)).toBeGreaterThanOrEqual(Number(r.total) * 0.9);
  });

  it("finds a decree by the ministry it funds, whole-word", async () => {
    const [one] = await allRows<{ id_mat: number; budget_of: string }>(
      "SELECT id_mat, budget_of FROM budget_spending_decree WHERE budget_of IS NOT NULL LIMIT 1",
    );
    const hits = await allRows<{ id_mat: number }>(
      "SELECT id_mat FROM spending_decree_mentions($1, 100)",
      [one.budget_of],
    );
    expect(hits.length).toBeGreaterThan(0);
    const [cov] = await allRows<{ decrees: string }>(
      "SELECT decrees::text FROM spending_decree_coverage()",
    );
    expect(cov.decrees).toBe(n);
  });
});

await end();
