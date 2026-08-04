// The annex fold must never assign a contract another contract's value.
//
// WHY: the УНП+supplier (K2) join key is lot-agnostic, so one supplier holding
// several contracts under one procedure used to merge their annexes into one
// accumulator — anchoring on contract A's earliest annex while serving contract
// B's latest value, past every guard (a perfect continuity match). On УНП
// 00536-2023-0049 that folded Дансон трейдинг's №4354/15.04.2024 from
// €352,343.97 to €158,991.32: a fabricated −€193,352.65 from two zero-diff
// annexes. resolveAnnexKey now refuses a provably multi-contract key
// (annexResolve.ts, guard 4); this gate holds the OUTCOME in Postgres, where
// the fold and the annexes loader meet.
//
// THE INVARIANT: a single-supplier contract whose annexes the loader attached
// via the contract-precise key (match_via='contract_no') must carry ONE of its
// own latest-date annex values — within a cent, either as amount_eur (the fold
// flipped it) or as amount_eur == signing when the annex moved nothing. The SQL
// mirrors the fold's semantics deliberately: the ordering key is
// coalesce(publication_date, contract_date, '') (the fold's `pub`), ties on
// that key are accepted if ANY tied value matches (the fold's tie-break is
// first-in-file-order, which SQL cannot reconstruct), and a NULL amount_eur on
// a matched contract counts as a violation, not an exemption. Consortium rows
// are excluded — their amount_eur is a per-supplier split of the full annex
// value — via the row-count proxy `(unp, contract_id) has one contract row`;
// see the failure message for the one shape the proxy cannot see.
//
// Skips only when Postgres itself is down; an unloaded annexes table is an
// ASSERTION, not a skip (the kzk_decisions.data.test.ts convention) — an empty
// linkage corpus is this gate's greenest and most useless state.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, withClient, end } from "../lib/pg";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  await end();
});

// The general invariant. `sibs` counts sibling rows with a window over
// (unp, contract_id) — identical NULL-grouping semantics to an
// IS-NOT-DISTINCT-FROM self-join, but hashable: the join form re-ran the 405k
// row aggregate once per candidate (4.2s idle, worse the redder it gets); this
// shape is one pass (~0.9s measured). A contract is flagged when NO latest-date
// annex value matches its amount_eur (bool_or over the ties), including a NULL
// amount_eur on a matched contract.
const GENERAL_SQL = `
  WITH own AS (
    SELECT contract_key,
           max(coalesce(publication_date, contract_date, '')) AS pub
    FROM procurement_annexes
    WHERE match_via = 'contract_no'
    GROUP BY 1
  ),
  latest AS (
    SELECT o.contract_key, a.current_value_eur
    FROM own o
    JOIN procurement_annexes a
      ON a.contract_key = o.contract_key
     AND a.match_via = 'contract_no'
     AND coalesce(a.publication_date, a.contract_date, '') = o.pub
  ),
  sibs AS (
    SELECT key, unp, contract_id, contractor_name, amount_eur,
           count(*) OVER (PARTITION BY unp, contract_id) AS n
    FROM contracts
    WHERE tag = 'contract'
  )
  SELECT c.key, c.unp, c.contract_id, c.contractor_name,
         c.amount_eur::text AS amount_eur,
         string_agg(DISTINCT l.current_value_eur::text, ' | ') AS own_annex
  FROM sibs c
  JOIN latest l ON l.contract_key = c.key
  WHERE c.n = 1
  GROUP BY c.key, c.unp, c.contract_id, c.contractor_name, c.amount_eur
  HAVING NOT bool_or(
    c.amount_eur IS NOT NULL
    AND abs(c.amount_eur - l.current_value_eur) <= 0.01
  )
`;

interface ViolationRow {
  key: string;
  unp: string | null;
  contract_id: string | null;
  contractor_name: string | null;
  amount_eur: string | null;
  own_annex: string;
}

const formatViolations = (rows: ViolationRow[]): string[] =>
  rows.map(
    (r) =>
      `${r.key} ${r.unp ?? ""}/${r.contract_id ?? ""} ${r.contractor_name ?? ""}: ` +
      `amount ${r.amount_eur ?? "NULL"} ∉ own annex {${r.own_annex}}`,
  );

test.skipIf(skip)(
  "the annexes linkage corpus is populated — the gate is not vacuous",
  async () => {
    const [t] = await allRows<{ present: boolean }>(
      "SELECT to_regclass('public.procurement_annexes') IS NOT NULL AS present",
    );
    assert.ok(
      t.present,
      "procurement_annexes is ABSENT — run `npm run db:load:annexes:pg` " +
        "(applies migration 114; needs the raw_data/procurement/anexi cache).",
    );
    const [cov] = await allRows<{ n: string }>(
      "SELECT count(DISTINCT contract_key)::text AS n FROM procurement_annexes " +
        "WHERE match_via = 'contract_no'",
    );
    assert.ok(
      Number(cov.n) > 0,
      "procurement_annexes has no contract_no-matched rows — the general " +
        "invariant below is vacuously green. Run `npm run db:load:annexes:pg` " +
        "(needs the raw_data/procurement/anexi cache).",
    );
  },
);

test.skipIf(skip)(
  "no single-supplier contract contradicts its own contract_no-matched annex",
  async () => {
    const rows = await allRows<ViolationRow>(GENERAL_SQL);
    assert.deepEqual(
      formatViolations(rows),
      [],
      "contract(s) serving a value that matches NONE of their own " +
        "precisely-matched latest annex values — the multi-contract key " +
        "collision shape. Re-run `anexi_current_value --apply` → " +
        "`rebuild_from_cache` → `db:load:pg` → `db:load:annexes:pg`; if it " +
        "persists, the resolver's ambiguity refusal regressed (annexResolve.ts " +
        "guard 4). ONE benign shape the single-supplier proxy cannot see: if " +
        "amount ≈ own annex / N for a small integer N, the annex FEED's " +
        "supplier list had N members while our corpus holds one row — a " +
        "per-supplier split of a full annex value (see 114's CONTRACT-TOTAL " +
        "warning), not a collision.",
    );
  },
);

test.skipIf(skip)(
  "the general query still discriminates — the original collision, replayed, is caught",
  async () => {
    // Prove the red path (the person_connections.data.test.ts precedent):
    // re-create the −€193,352.65 misfold inside a rolled-back transaction —
    // №4354 (the larger Дансон contract) is given its sibling's value — and
    // assert the general query flags exactly that row.
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const { rows: dan } = await c.query<{
          key: string;
          amount_eur: string;
        }>(
          `SELECT key, amount_eur::text FROM contracts
           WHERE unp = '00536-2023-0049' AND contractor_eik = '206534575'
             AND tag = 'contract'
           ORDER BY amount_eur DESC`,
        );
        assert.equal(
          dan.length,
          2,
          `expected the two Дансон contracts under 00536-2023-0049, got ${dan.length}`,
        );
        const [big, small] = dan;
        await c.query("UPDATE contracts SET amount_eur = $1 WHERE key = $2", [
          small.amount_eur,
          big.key,
        ]);
        const { rows } = await c.query<ViolationRow>(GENERAL_SQL);
        assert.ok(
          rows.some((r) => r.key === big.key),
          `the replayed collision on ${big.key} was NOT flagged — the general ` +
            "query no longer discriminates and this gate is decorative",
        );
      } finally {
        await c.query("ROLLBACK");
      }
    });
  },
);

test.skipIf(skip)(
  "УНП 00536-2023-0049: Дансон's №4354 carries its own value, not its sibling's",
  async () => {
    // The original defect, pinned by shape rather than by row key (keys shift
    // when a feed re-parses): under this УНП the supplier holds two contracts
    // whose annexes both published zero-diff values, so each contract's
    // amount_eur must equal ITS OWN annex value and the two must differ.
    const rows = await allRows<{ contract_id: string; amount_eur: string }>(
      `SELECT contract_id, amount_eur::text
       FROM contracts
       WHERE unp = '00536-2023-0049'
         AND contractor_eik = '206534575'
         AND tag = 'contract'
       ORDER BY contract_id`,
    );
    assert.equal(
      rows.length,
      2,
      `expected the two Дансон contracts under 00536-2023-0049, got ${rows.length}`,
    );
    const amounts = rows.map((r) => Number(r.amount_eur)).sort((a, b) => a - b);
    // Two invariants with different remediations, asserted separately so a
    // failure routes the operator correctly.
    assert.notEqual(
      amounts[0],
      amounts[1],
      "the two Дансон contracts share one value — the −€193,352.65 fold " +
        "collision shipping again (annexResolve.ts ambiguity refusal regressed)",
    );
    assert.deepEqual(
      amounts,
      [158991.32, 352343.97],
      "the Дансон values moved but stayed DISTINCT — likely a NEW legitimate " +
        "annex, not the collision. Verify on ЦАИС ЕОП for УНП 00536-2023-0049, " +
        "then update this pin (and confirm the general invariant stayed green).",
    );
  },
);
