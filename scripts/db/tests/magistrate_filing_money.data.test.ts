// The ИВСС money tables (202) — № 10 cash, № 11 bank accounts, № 13 debts — per filing.
//
// Two jobs, and the first is the reason this gate exists at all:
//
//  1. ⚠️ STORAGE ONLY STAYS STORAGE ONLY. The owner decided (2026-10-21) that these rows may
//     not reach a page until a register-arbitration rule exists — 090 keeps ONE declaration
//     per (person, year), so wiring them in would pick between the ИВСС and the КПКОНПИ /
//     Сметна палата registers silently. 202 enforces it by granting app_readonly nothing; this
//     asserts the grant is still absent and that no stored query reads the tables, so the
//     decision cannot be undone by a migration that forgot it was one.
//  2. A wrong parse can be told from a right one. The document carries its own redundancy —
//     an equivalence cell beside each amount — and the reader values a row from the AMOUNT, so
//     the identity holding on the stored corpus is evidence the columns were read correctly.
//
// Auto-skips when Postgres is down, and SEPARATELY when the money tables are empty: the input
// is the operator crawl's `--backfill-money` pass, absent on most machines. „Not parsed yet"
// must never read as „the rule holds".
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

const PEG = 1.95583;

const state = async (): Promise<"down" | "empty" | "ok"> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM magistrate_filing_money_read",
    );
    return Number(c.n) > 0 ? "ok" : "empty";
  } catch {
    return "down";
  }
};

const s = await state();
const skip =
  s === "down"
    ? "Postgres unreachable / migration 202 not applied"
    : s === "empty"
      ? "magistrate_filing_money_read empty — the crawl's --backfill-money pass has not run here"
      : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

test("storage only: app_readonly cannot read either table, and no stored query does", async () => {
  if (s === "down") return;
  // Runs on an EMPTY corpus too — the guarantee is about the schema, not the rows.
  const [role] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM pg_roles WHERE rolname = 'app_readonly'",
  );
  if (Number(role.n) > 0) {
    const grants = await allRows<{ t: string }>(
      `SELECT t FROM unnest(ARRAY['magistrate_filing_money','magistrate_filing_money_read']) t
        WHERE has_table_privilege('app_readonly', t, 'SELECT')`,
    );
    assert.deepEqual(
      grants.map((g) => g.t),
      [],
      "app_readonly can SELECT a storage-only table — adding that grant is the register-" +
        "arbitration decision (see 202's header), not a fix",
    );
  }
  // A view/matview/function that reads the table is the other way in: a SECURITY-less view
  // runs with its owner's rights. Both pg_rewrite (views) and pg_proc bodies are checked —
  // a LANGUAGE sql string body records no pg_depend edge.
  const readers = await allRows<{ name: string }>(
    `SELECT c.relname AS name FROM pg_depend d
       JOIN pg_rewrite rw ON rw.oid = d.objid
       JOIN pg_class c ON c.oid = rw.ev_class
      WHERE d.refobjid IN ('magistrate_filing_money'::regclass,
                           'magistrate_filing_money_read'::regclass)
        AND c.relname NOT IN ('magistrate_filing_money', 'magistrate_filing_money_read')
     UNION
     -- A BEGIN ATOMIC body (PG14+) has an empty prosrc; its edge is recorded HERE.
     SELECT p.proname FROM pg_depend d
       JOIN pg_proc p ON p.oid = d.objid AND d.classid = 'pg_proc'::regclass
      WHERE d.refobjid IN ('magistrate_filing_money'::regclass,
                           'magistrate_filing_money_read'::regclass)
     UNION
     SELECT p.proname FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
      WHERE p.prosrc ~ 'magistrate_filing_money'`,
  );
  assert.deepEqual(
    readers.map((r) => r.name),
    [],
    "a stored query reads the storage-only money tables",
  );
});

test("every money row sits under a READ (not refused) table whose count matches", async () => {
  if (skip) return;
  const [r] = await allRows<{
    orphan: string;
    refusedWithRows: string;
    miscount: string;
  }>(
    `WITH n AS (SELECT source_url, table_num, count(*) c FROM magistrate_filing_money
                 GROUP BY 1, 2)
     SELECT
       (SELECT count(*) FROM n WHERE NOT EXISTS (
          SELECT 1 FROM magistrate_filing_money_read r
           WHERE r.source_url = n.source_url AND r.table_num = n.table_num))::text AS orphan,
       (SELECT count(*) FROM n JOIN magistrate_filing_money_read r USING (source_url, table_num)
         WHERE r.refused IS NOT NULL)::text AS "refusedWithRows",
       (SELECT count(*) FROM magistrate_filing_money_read r
          LEFT JOIN n USING (source_url, table_num)
         WHERE r.refused IS NULL AND r.row_count <> COALESCE(n.c, 0))::text AS miscount`,
  );
  assert.equal(Number(r.orphan), 0, "money rows with no read record");
  assert.equal(
    Number(r.refusedWithRows),
    0,
    "rows stored under a REFUSED table",
  );
  assert.equal(Number(r.miscount), 0, "read records whose row_count disagrees");
});

test("only current-form filings yield rows; older forms are refused, never read", async () => {
  if (skip) return;
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM magistrate_filing_money m
       JOIN magistrate_filing f ON f.source_url = m.source_url
      WHERE f.form_version IS DISTINCT FROM '3.0' AND f.form_version IS DISTINCT FROM '4.0'`,
  );
  assert.equal(Number(r.n), 0, "money rows from a pre-v3.0 form");
});

test("value_eur follows the one rule: euro amount, лев amount at the peg, else the equivalence", async () => {
  if (skip) return;
  const [r] = await allRows<{ eur: string; bgn: string; other: string }>(
    `SELECT
       count(*) FILTER (WHERE currency = 'EUR'
         AND (value_basis <> 'amount-eur' OR abs(value_eur - amount) > 0.01))::text AS eur,
       count(*) FILTER (WHERE currency = 'BGN'
         AND (value_basis <> 'amount-bgn' OR abs(value_eur - amount / ${PEG}) > 0.01))::text AS bgn,
       count(*) FILTER (WHERE currency NOT IN ('EUR', 'BGN')
         AND NOT ((equiv IS NULL AND value_eur IS NULL)
               OR (value_basis = 'equiv' AND abs(value_eur -
                    CASE equiv_unit WHEN 'EUR' THEN equiv ELSE equiv / ${PEG} END) <= 0.01)))::text AS other
       FROM magistrate_filing_money`,
  );
  assert.equal(Number(r.eur), 0, "EUR rows not valued from their amount");
  assert.equal(Number(r.bgn), 0, "BGN rows not valued at the peg");
  assert.equal(
    Number(r.other),
    0,
    "third-currency rows not valued from the equivalence",
  );
});

test("the document's own redundancy holds on the stored corpus", async () => {
  if (skip) return;
  // On a BGN/EUR row with an equivalence, equiv must equal amount × rate. A COLUMN misread
  // lands far from that; declarant arithmetic lands near it (a 2.0 rate, a one-digit typo).
  // Measured on the validation sample: 450 of 452 within 1%, and both misses printed so in
  // the PDF. The floor allows the declarants their errors and nothing like a shifted column.
  const [r] = await allRows<{ checkable: string; ok: string; rate2: string }>(
    `WITH x AS (
       SELECT amount * CASE WHEN currency = 'EUR' AND equiv_unit = 'BGN' THEN ${PEG}
                            WHEN currency = 'BGN' AND equiv_unit = 'EUR' THEN 1 / ${PEG}
                            ELSE 1 END AS expected, equiv, currency, amount
         FROM magistrate_filing_money
        WHERE equiv IS NOT NULL AND currency IN ('BGN', 'EUR') AND amount > 0)
     SELECT count(*)::text AS checkable,
            count(*) FILTER (WHERE abs(equiv - expected) <= greatest(1, expected * 0.01))::text AS ok,
            count(*) FILTER (WHERE currency = 'EUR' AND abs(equiv / amount - 2) <= 0.02)::text AS rate2
       FROM x`,
  );
  const checkable = Number(r.checkable);
  assert.ok(
    checkable > 0,
    "no checkable rows — the identity cannot be measured",
  );
  // A rate of 2.0 is a declarant convention, not a misread; it is excluded from the base.
  const share = Number(r.ok) / (checkable - Number(r.rate2));
  assert.ok(
    share >= 0.97,
    `only ${(share * 100).toFixed(1)}% of checkable money rows satisfy their own equivalence ` +
      `(${r.ok}/${checkable}, ${r.rate2} at a 2.0 rate) — a column has shifted`,
  );
});

test("the reference filing: Цацаров 2026 reads as hand-checked", async () => {
  if (skip) return;
  const rows = await allRows<{
    table_num: string;
    amount: string;
    currency: string;
  }>(
    `SELECT m.table_num, m.amount::text, m.currency
       FROM magistrate_filing_money m
       JOIN magistrate_filing f ON f.source_url = m.source_url
      WHERE m.magistrate_name LIKE 'Сотир%Цацаров' AND f.period_year = 2025
      ORDER BY m.table_num, m.ord`,
  );
  if (!rows.length) return; // that filing not yet parsed for money on this database
  assert.deepEqual(
    rows.map((r) => [r.table_num, Number(r.amount), r.currency]),
    [
      ["10", 4500, "BGN"],
      ["11", 8858, "BGN"],
      ["11", 2510, "EUR"],
      ["13", 187760, "BGN"],
      ["13", 30000, "BGN"],
    ],
  );
});
