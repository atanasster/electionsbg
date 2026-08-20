// Gates for the ИСУН clean-delivery register (migration 175, plan P9 re-scoped).
//
// The load-bearing tests here are the ones that stop this becoming an accusation
// dataset: the caveat must exist, and the two reports must be allowed to disagree.

import { describe, expect, it } from "vitest";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const [{ n } = { n: "0" }] = haveDb
  ? await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM isun_clean_contract",
    ).catch(() => [{ n: "0" }])
  : [{ n: "0" }];
const skip = !haveDb
  ? "Postgres unreachable"
  : n === "0"
    ? "isun_clean_contract is empty — run npm run db:load:clean-delivery:pg"
    : null;
const d = skip ? describe.skip : describe;
if (skip) console.warn(`isun_clean_delivery.data.test: skipped — ${skip}`);

d("isun clean delivery (175)", () => {
  it("both tables are loaded and agree with the coverage row", async () => {
    const [r] = await allRows<{ c: string; b: string; dc: string; db: string }>(
      `SELECT (SELECT count(*) FROM isun_clean_contract)::text c,
              (SELECT count(*) FROM isun_clean_beneficiary)::text b,
              (SELECT contracts FROM isun_clean_delivery_coverage WHERE id=1)::text dc,
              (SELECT beneficiaries FROM isun_clean_delivery_coverage WHERE id=1)::text db`,
    );
    expect(r.c).toBe(r.dc);
    expect(r.b).toBe(r.db);
  });

  it("the absence caveat exists and is a real sentence", async () => {
    // This is the field that stops a consumer inverting the register. 175 makes it
    // NOT NULL; this asserts it is also not an empty string someone satisfied the
    // constraint with.
    const [r] = await allRows<{ m: string }>(
      "SELECT absence_meaning m FROM isun_clean_delivery_coverage WHERE id=1",
    );
    expect(r.m.length).toBeGreaterThan(80);
    expect(r.m).toMatch(/НЕ означава/);
  });

  it("every contract joins fund_projects on contract_number", async () => {
    const [r] = await allRows<{ missing: string }>(
      `SELECT count(*)::text missing FROM isun_clean_contract c
         LEFT JOIN fund_projects f ON f.contract_number = c.contract_number
        WHERE f.contract_number IS NULL`,
    );
    expect(r.missing).toBe("0");
  });

  it("the -C## strip DISCRIMINATES — joining on reg_no would match almost nothing", async () => {
    // Mutation check. Without it, the previous test passes on any implementation
    // that happens to join, including one that silently stopped stripping.
    const [r] = await allRows<{ raw: string; base: string }>(
      `SELECT (SELECT count(*) FROM isun_clean_contract c
                 JOIN fund_projects f ON f.contract_number = c.reg_no)::text raw,
              (SELECT count(*) FROM isun_clean_contract c
                 JOIN fund_projects f ON f.contract_number = c.contract_number)::text base`,
    );
    expect(Number(r.base)).toBeGreaterThan(Number(r.raw) * 100);
  });

  it("stores NO personal identifiers — every eik is 9 or 13 digits", async () => {
    // A 10-digit value here would be an ЕГН. Natural persons are excluded entirely.
    const [r] = await allRows<{ bad: string }>(
      `SELECT (
         (SELECT count(*) FROM isun_clean_beneficiary WHERE eik !~ '^[0-9]{9}([0-9]{4})?$')
       + (SELECT count(*) FROM isun_clean_contract
           WHERE beneficiary_eik IS NOT NULL AND beneficiary_eik !~ '^[0-9]{9}([0-9]{4})?$')
       )::text bad`,
    );
    expect(r.bad).toBe("0");
  });

  it("the excluded natural persons are COUNTED, not silently dropped", async () => {
    const [r] = await allRows<{ n: string }>(
      "SELECT natural_persons_excluded::text n FROM isun_clean_delivery_coverage WHERE id=1",
    );
    expect(Number(r.n)).toBeGreaterThan(0);
  });

  it("the two reports are ALLOWED to disagree — do not reconcile them", async () => {
    // 9,940 clean contracts vs ~41,530 on-time contracts. They count different
    // populations, and each listing's own pager confirms both exports are complete
    // (398 and 1,359 pages). If a future change makes these equal, someone has
    // "fixed" a disagreement that is real — this fails so they notice.
    const [r] = await allRows<{ c: string; o: string }>(
      `SELECT (SELECT count(*) FROM isun_clean_contract)::text c,
              (SELECT on_time_contracts_declared FROM isun_clean_delivery_coverage WHERE id=1)::text o`,
    );
    expect(Number(r.o)).toBeGreaterThan(Number(r.c) * 2);
  });

  it("the per-company read returns the caveat alongside the number", async () => {
    const rows = await allRows<{ eik: string; absence_meaning: string }>(
      `SELECT * FROM isun_clean_delivery_for_eik(
         (SELECT eik FROM isun_clean_beneficiary ORDER BY on_time_contracts DESC LIMIT 1))`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].absence_meaning ?? "").toMatch(/НЕ означава/);
  });
});

await end();
