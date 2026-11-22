// Tier 3 (Postgres-native) — a SUPPLIER LIST filed as one row is a framework, not spend.
//
// The legacy РОП register files a multi-winner award as ONE row naming every winner with
// ONE combined value. 087's framework tag only fires on a procedure split into one row per
// supplier, so before `tag_supplier_list_frameworks()` such a row counted its whole ceiling
// as money spent: МЗ's 2020 central-medicines framework (УНП 00080-2019-0022, €553M in two
// rows) moved the /sector/health procurement headline €1.62bn → €2.30bn while its real
// call-offs were already in the corpus.
//
// Three things are asserted:
//   1. the SQL predicate `is_supplier_list()` agrees with the TS `isSupplierList` the ingest
//      uses, over every distinct comma-bearing supplier name in the corpus — two definitions
//      of one rule, so a drift here is exactly the defect class 087's header warns about;
//   2. every `nm-` supplier-list contract row carries joint_kind='framework';
//   3. the reference МЗ framework is among them (non-vacuity — a predicate that matched
//      nothing would pass assertion 2 trivially).
//
//   pnpm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { isSupplierList } from "../../procurement/normalize_rop";
import { reportSkip } from "../../lib/report_skip";

const ready = async (): Promise<string | false> => {
  try {
    const [r] = await allRows<{ fn: boolean; t: boolean }>(
      `SELECT to_regprocedure('is_supplier_list(text)') IS NOT NULL AS fn,
              to_regclass('public.contracts') IS NOT NULL AS t`,
    );
    if (!r?.t) return "contracts table absent";
    if (!r.fn)
      return "is_supplier_list() not applied — apply 087_procurement_consortium.sql";
    return false;
  } catch {
    return "Postgres unreachable";
  }
};

const skip = await ready();
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "is_supplier_list() agrees with the TS isSupplierList on every comma-bearing name",
  async () => {
    const rows = await allRows<{ n: string; sql: boolean }>(
      `SELECT n, is_supplier_list(n) AS sql
         FROM (SELECT DISTINCT contractor_name AS n FROM contracts
                WHERE contractor_name LIKE '%,%') d`,
    );
    assert.ok(rows.length > 1000, `only ${rows.length} comma-bearing names`);
    const wrong = rows.filter((r) => r.sql !== isSupplierList(r.n));
    assert.equal(
      wrong.length,
      0,
      `${wrong.length} name(s) where SQL and TS disagree, e.g. ` +
        wrong
          .slice(0, 5)
          .map((r) => `${r.sql ? "SQL-only" : "TS-only"}: ${r.n.slice(0, 80)}`)
          .join(" | "),
    );
    // Both answers occur, so the comparison is not over a constant.
    assert.ok(rows.some((r) => r.sql) && rows.some((r) => !r.sql));
  },
);

test.skipIf(skip)(
  "every nm- supplier-list contract row is tagged as a framework",
  async () => {
    const rows = await allRows<{ key: string; n: string; j: string | null }>(
      `SELECT key, contractor_name AS n, joint_kind AS j FROM contracts
        WHERE contractor_eik LIKE 'nm-%' AND tag = 'contract'
          AND is_supplier_list(contractor_name)`,
    );
    assert.ok(rows.length > 0, "no supplier-list rows at all");
    const untagged = rows.filter((r) => r.j !== "framework");
    assert.equal(
      untagged.length,
      0,
      `${untagged.length} supplier-list row(s) count their whole ceiling as spend — ` +
        `run SELECT tag_supplier_list_frameworks(). e.g. ` +
        untagged
          .slice(0, 3)
          .map((r) => `${r.key} ${r.n.slice(0, 60)}`)
          .join(" | "),
    );
  },
);

test.skipIf(skip)(
  "the reference МЗ central-medicines framework is tagged",
  async () => {
    const rows = await allRows<{ eur: number; j: string | null }>(
      `SELECT amount_eur AS eur, joint_kind AS j FROM contracts
        WHERE unp = '00080-2019-0022' AND contractor_eik LIKE 'nm-%'
          AND tag = 'contract' AND amount_eur > 100000000`,
    );
    if (rows.length === 0) {
      reportSkip(import.meta.url, "the 2020 РОП year is not in this corpus");
      return;
    }
    assert.ok(
      rows.every((r) => r.j === "framework"),
      "a €100M+ МЗ list row is not tagged",
    );
  },
);
