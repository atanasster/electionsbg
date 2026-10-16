// Standing gate for the contract-number-less legacy twin class
// (scripts/procurement/pre_contract_id_twins.ts; plan
// docs/plans/procurement-same-feed-dedup-v1.md §7). 12,397 such rows — €1.18bn, 1.2% of the
// contracts corpus — double-counted on 2026-10-17 with every row count reconciling, because a
// key change is invisible to every check keyed on the key.
//
// It fails until `npm run proc:dedup-pre-cid -- --apply` + the reload chain has run, and again
// the day an ingest re-introduces the class. Rules 1–2 of the module only (no fresh parse — the
// raw dumps are gitignored): safe for a GATE, which deletes nothing.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end, withTx } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

// Native amount + currency + title + release_id — the module's siblingKey.
const TWINS_SQL = `
  SELECT n.key, n.release_id, n.amount_eur::float8 amount_eur
    FROM contracts n
   WHERE n.release_id LIKE 'aop-legacy-%' AND n.tag = 'contract'
     AND coalesce(n.contract_id, '') = ''
     AND EXISTS (SELECT 1 FROM contracts s
                  WHERE s.release_id = n.release_id AND s.tag = 'contract'
                    AND coalesce(s.contract_id, '') <> ''
                    AND s.amount IS NOT DISTINCT FROM n.amount
                    AND s.currency IS NOT DISTINCT FROM n.currency
                    AND s.title IS NOT DISTINCT FROM n.title)`;

test.skipIf(skip)(
  "no legacy contract row without a contract number sits beside its numbered twin",
  async () => {
    const rows = await allRows<{
      key: string;
      release_id: string;
      amount_eur: number;
    }>(`${TWINS_SQL} LIMIT 20`);
    const [{ n, eur }] = await allRows<{ n: number; eur: number }>(
      `SELECT count(*)::int n, coalesce(sum(amount_eur), 0)::float8 eur FROM (${TWINS_SQL}) t`,
    );
    assert.equal(
      n,
      0,
      `${n} contract-number-less legacy twin(s), €${Math.round(eur)} double-counted — run ` +
        `\`npm run proc:dedup-pre-cid\` (dry run, then --apply), then the reload chain. First: ` +
        rows.map((r) => `${r.key} ${r.release_id}`).join(", "),
    );
  },
);

test.skipIf(skip)(
  "the gate still discriminates (planted twin, rolled back)",
  async () => {
    // Plant a copy of a real numbered legacy row with its contract number removed, run the gate's
    // query, then roll back. Without this the gate above passes on a query that matches nothing.
    const found = await withTx(async (c) => {
      const { rows } = await c.query<{ key: string }>(
        `SELECT key FROM contracts WHERE release_id LIKE 'aop-legacy-%' AND tag = 'contract'
          AND coalesce(contract_id, '') <> '' AND amount IS NOT NULL LIMIT 1`,
      );
      assert.ok(rows.length, "no numbered legacy row to plant a twin of");
      // Copy every non-generated column (contracts carries generated *_fold columns).
      const { rows: cols } = await c.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'contracts' AND table_schema = current_schema()
            AND is_generated = 'NEVER' ORDER BY ordinal_position`,
      );
      const names = cols.map((x) => x.column_name);
      const select = names.map((n) =>
        n === "key"
          ? "'zz-planted-twin'"
          : n === "contract_id"
            ? "NULL"
            : `"${n}"`,
      );
      await c.query(
        `INSERT INTO contracts (${names.map((n) => `"${n}"`).join(", ")})
         SELECT ${select.join(", ")} FROM contracts WHERE key = $1`,
        [rows[0].key],
      );
      const { rows: hit } = await c.query(`SELECT 1 FROM (${TWINS_SQL}) t WHERE t.key = 'zz-planted-twin'`); // prettier-ignore
      throw Object.assign(new Error("rollback"), { found: hit.length });
    }).catch((e: Error & { found?: number }) => {
      // Only the rollback sentinel carries `found`; anything else (a SQL error) is a real failure.
      if (e.found === undefined) throw e;
      return e.found;
    });
    assert.equal(found, 1, "the gate's query no longer finds a planted twin");
  },
);
