// Gate for the agri publish invariants (gaps plan T2): the DELETE+INSERT
// publish must leave no stage residue, keep exactly 046's index set under the
// canonical names (the abandoned rename-swap draft would have grown duplicate
// indexes every reload), and keep the two dependent matviews pointed at the
// live table — the defect that killed the swap was them following the OID onto
// agri_subsidies_old.
//
// Auto-skips when Postgres is down or agri is unloaded, like the other
// *.data.test.ts gates.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const loaded =
  haveDb &&
  (
    await allRows<{ n: string }>("SELECT count(*) n FROM agri_subsidies").catch(
      () => [{ n: "0" }],
    )
  ).some((r) => Number(r.n) > 0);
const skip = !haveDb
  ? "Postgres unreachable"
  : !loaded
    ? "agri_subsidies is empty"
    : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "no agri stage or _old residue tables survive a publish",
  async () => {
    const rows = await allRows<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
      WHERE tablename LIKE 'agri_subsidies\\_%' OR tablename LIKE 'agri_payloads\\_%'`,
    );
    assert.deepEqual(
      rows.map((r) => r.tablename),
      [],
      "leftover stage/_old tables — a publish aborted mid-way or the drop was skipped",
    );
  },
);

test.skipIf(skip)(
  "agri_subsidies carries exactly 046's indexes under canonical names",
  async () => {
    const rows = await allRows<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'agri_subsidies'",
    );
    assert.deepEqual(
      rows.map((r) => r.indexname).sort(),
      [
        "agri_subsidies_pkey",
        "idx_agri_eik",
        "idx_agri_eik_total",
        "idx_agri_name_trgm",
        "idx_agri_oblast_total",
        "idx_agri_scheme",
        "idx_agri_total",
        "idx_agri_year_total",
      ],
      "index set drifted from 046 — a duplicate build or a lost index",
    );
  },
);

test.skipIf(skip)(
  "the dependent matviews still read the live agri_subsidies",
  async () => {
    const rows = await allRows<{ relname: string }>(
      `SELECT DISTINCT dependent.relname
       FROM pg_depend d
       JOIN pg_rewrite r ON d.objid = r.oid
       JOIN pg_class dependent ON r.ev_class = dependent.oid
       JOIN pg_class source ON d.refobjid = source.oid
      WHERE source.relname = 'agri_subsidies'
        AND dependent.relkind = 'm'`,
    );
    const names = new Set(rows.map((r) => r.relname));
    for (const mv of ["person_browse_table", "company_public_money"])
      assert.ok(
        names.has(mv),
        `${mv} no longer depends on agri_subsidies — it is reading a renamed/stale table`,
      );
  },
);
