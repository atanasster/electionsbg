// Gates for the ИСУН clean-delivery register (migration 175, plan P9 re-scoped).
//
// The load-bearing tests here are the ones that stop this becoming an accusation
// dataset: the caveat must exist, and the two reports must be allowed to disagree.

import { describe, expect, it } from "vitest";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

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
reportSkip(import.meta.url, skip);

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

  // ── the both-registers drive (the 2026-09-02 rewrite) ────────────────────────
  //
  // The test above picks a beneficiary by construction, so it passes unchanged
  // against the OLD beneficiary-only function. These three are what actually hold
  // the rewrite: without them a revert to `FROM isun_clean_beneficiary` is green.

  it("drives from BOTH registers — a contract-only EIK returns a row", async () => {
    const [pick] = await allRows<{ eik: string }>(
      `SELECT c.beneficiary_eik eik FROM isun_clean_contract c
         LEFT JOIN isun_clean_beneficiary b ON b.eik = c.beneficiary_eik
        WHERE c.beneficiary_eik IS NOT NULL AND b.eik IS NULL
        ORDER BY c.beneficiary_eik LIMIT 1`,
    );
    const rows = await allRows<{
      on_time_contracts: number | null;
      clean_contracts: string;
      beneficiary_listed: boolean;
      contracts: unknown[];
      name: string | null;
    }>("SELECT * FROM isun_clean_delivery_for_eik($1)", [pick.eik]);

    // Beneficiary-driven, this was 0 rows — for 956 EIKs / 1,740 clean contracts.
    expect(rows).toHaveLength(1);
    expect(rows[0].beneficiary_listed).toBe(false);
    // ⚠️ NULL, NEVER 0. „Not listed as a correction-free beneficiary" is not
    // „listed with zero on-time contracts", and only the second is a number. The
    // corpus cannot distinguish them (0 of 32,420 rows carry a literal 0), so this
    // assertion is the only thing that does.
    expect(rows[0].on_time_contracts).toBeNull();
    expect(Number(rows[0].clean_contracts)).toBeGreaterThan(0);
    // The named evidence, not just a count — and one entry per counted row.
    expect(rows[0].contracts).toHaveLength(Number(rows[0].clean_contracts));
    // Falls back to the contract register's own spelling of the name.
    expect(rows[0].name ?? "").not.toBe("");
  });

  it("the contract-only population is NON-TRIVIAL — the rewrite earns its keep", async () => {
    // Mutation-style companion to the test above: it fails on a corpus where the
    // two registers happen to coincide, so a green run there cannot be mistaken
    // for the drive being exercised. Measured 2026-09-02: 956 EIKs / 1,740 rows.
    const [r] = await allRows<{ eiks: string; rows: string }>(
      `SELECT count(DISTINCT c.beneficiary_eik)::text eiks, count(*)::text rows
         FROM isun_clean_contract c
         LEFT JOIN isun_clean_beneficiary b ON b.eik = c.beneficiary_eik
        WHERE c.beneficiary_eik IS NOT NULL AND b.eik IS NULL`,
    );
    expect(Number(r.eiks)).toBeGreaterThan(500);
    expect(Number(r.rows)).toBeGreaterThan(900);
  });

  it("an EIK in NEITHER register returns NO row — absence is not a finding", async () => {
    // The property the whole tile rests on: no row, no tile, so a zero can never
    // be rendered against a company the register simply does not mention.
    expect(
      await allRows("SELECT * FROM isun_clean_delivery_for_eik('999999999')"),
    ).toHaveLength(0);
  });

  it("clean_contracts counts CONTRACTS, not versions of one contract", async () => {
    // `contract_number` is `reg_no` with the -C## contract-VERSION suffix stripped,
    // and nothing constrains it to one row. `clean_contracts` is count(*), and it
    // renders as „N проекта без наложена финансова корекция" against a named
    // company — so the day the register publishes two versions of one contract,
    // that N inflates and the `contracts` array shows two entries a reader cannot
    // tell apart (the projection drops `reg_no`). Deliberately a gate rather than a
    // UNIQUE index: versions are a thing the SOURCE key has, so an index would
    // abort a legitimate future load instead of prompting a decision about what
    // this number should count.
    const [r] = await allRows<{ rows: string; distinct: string }>(
      `SELECT count(*)::text rows, count(DISTINCT contract_number)::text distinct
         FROM isun_clean_contract`,
    );
    expect(r.distinct).toBe(r.rows);
  });
});

await end();
