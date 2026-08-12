// The two CLASS C grants actually grant — the ones that live inside a plpgsql body and so
// run when their function is CALLED, not when their migration is applied.
//
// WHY THIS TEST IS SHAPED SO ODDLY. The obvious check — REVOKE, rebuild, assert the
// privilege came back — PROVES NOTHING for `contracts_list`, and I wrote that check first
// and believed it. `rebuild_contracts_list()` DROPs and recreates the view, which discards
// the REVOKE, and roles_readonly.sql's `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA
// public GRANT SELECT ON TABLES` then grants the fresh view automatically. Measured: a body
// with the GRANT deleted entirely still reports `true`.
//
// So the first case suppresses that backstop with `ALTER DEFAULT PRIVILEGES … IN SCHEMA
// public REVOKE …`. `IN SCHEMA public` is load-bearing: without it the ALTER targets a
// different pg_default_acl row, the backstop stays live, and the test silently goes back to
// proving nothing.
//
// Both cases run inside a ROLLED-BACK transaction rather than undoing themselves in a
// `finally`. Each mutates cluster-visible state — a default privilege, an ACL — and vitest
// runs test files in parallel, so a `finally` leaves a window where another test sees the
// mutation, and a hard kill leaves it permanently.
//
// `risk_upheld_ocid` (112) is the opposite case and is included for contrast: it uses CREATE
// OR REPLACE VIEW, which PRESERVES the ACL, so a plain REVOKE-then-rebuild does discriminate
// there.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end, withClient } from "../lib/pg";

const haveDb = await dbReachable();

const hasRole = haveDb
  ? (
      await allRows<{ ok: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') AS ok`,
      )
    )[0]?.ok === true
  : false;

const canSelect = async (rel: string): Promise<boolean> =>
  (
    await allRows<{ ok: boolean }>(
      `SELECT has_table_privilege('app_readonly', $1, 'SELECT') AS ok`,
      [rel],
    )
  )[0]?.ok === true;

afterAll(async () => {
  if (haveDb) await end();
});

test("rebuild_contracts_list() grants contracts_list — with the default-privilege backstop OFF", async (t) => {
  if (!haveDb || !hasRole) return t.skip();

  await withClient(async (c) => {
    // ALL OF IT INSIDE ONE ROLLED-BACK TRANSACTION. ALTER DEFAULT PRIVILEGES is a GLOBAL,
    // cluster-visible setting, and vitest runs test FILES in parallel — so suppressing it
    // for the ~30 s this test takes would leave any relation another .data.test.ts created
    // in that window ungranted, which is a cross-test failure that would look like a real
    // defect. It is also transactional, so a rollback removes the window entirely and
    // survives a hard kill, which a `finally` does not.
    await c.query("BEGIN");
    await c.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
         REVOKE SELECT ON TABLES FROM app_readonly`,
    );
    try {
      // Non-vacuity: with the backstop off, a view created WITHOUT an explicit grant must
      // come out unreadable. If this assertion fails, the suppression did not take and every
      // assertion below is meaningless.
      await c.query(`DROP VIEW IF EXISTS zz_grant_probe`);
      await c.query(`CREATE VIEW zz_grant_probe AS SELECT 1 AS x`);
      const { rows: probe } = await c.query(
        `SELECT has_table_privilege('app_readonly', 'zz_grant_probe', 'SELECT') AS ok`,
      );
      assert.equal(
        probe[0].ok,
        false,
        "ALTER DEFAULT PRIVILEGES did not suppress the backstop — this test cannot " +
          "distinguish a working GRANT from an absent one (check the IN SCHEMA clause)",
      );
      await c.query(`DROP VIEW zz_grant_probe`);

      await c.query(`SELECT rebuild_contracts_list()`);
      const { rows } = await c.query(
        `SELECT has_table_privilege('app_readonly', 'contracts_list', 'SELECT') AS ok`,
      );
      assert.ok(
        rows[0].ok,
        "contracts_list is not readable by app_readonly after rebuild_contracts_list() — " +
          "the guarded GRANT in 000_search_fns.sql is not granting, so /procurement/contracts " +
          "would 42501 while the corpus looks perfectly loaded",
      );
    } finally {
      // Undoes the ALTER, the probe view and the view rebuild in one step.
      await c.query("ROLLBACK");
    }
  });

  // Outside the rolled-back transaction: the object a reader actually hits is readable, and
  // the global default privilege is back the way it was.
  assert.ok(
    await canSelect("contracts_list"),
    "contracts_list left unreadable",
  );
});

test("rebuild_contract_risk_cache() grants risk_upheld_ocid", async (t) => {
  if (!haveDb || !hasRole) return t.skip();
  // CREATE OR REPLACE VIEW preserves the ACL, so a REVOKE survives the rebuild and this
  // check discriminates without touching default privileges.
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`REVOKE SELECT ON risk_upheld_ocid FROM app_readonly`);
      const { rows: gone } = await c.query(
        `SELECT has_table_privilege('app_readonly', 'risk_upheld_ocid', 'SELECT') AS ok`,
      );
      assert.equal(
        gone[0].ok,
        false,
        "the REVOKE did not take — this assertion cannot discriminate",
      );

      await c.query(`SELECT rebuild_contract_risk_cache()`);
      const { rows } = await c.query(
        `SELECT has_table_privilege('app_readonly', 'risk_upheld_ocid', 'SELECT') AS ok`,
      );
      assert.ok(
        rows[0].ok,
        "risk_upheld_ocid is not readable after rebuild_contract_risk_cache() — the " +
          "guarded EXECUTE in 112 is not granting",
      );
    } finally {
      await c.query("ROLLBACK");
    }
  });

  assert.ok(
    await canSelect("risk_upheld_ocid"),
    "risk_upheld_ocid left unreadable",
  );
});
