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
import { RISK_CACHE_LOCK_SQL } from "../lib/rebuildRiskCache";

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
  //
  // ⚠️ RETRIED ON CONCURRENT-WRITE LOSSES, because this test is a genuine participant in a
  // concurrency rather than a victim of one. `rebuild_contract_risk_cache()` drops and
  // recreates `risk_upheld_ocid`, and TWO data-test files call it (this one and
  // contract_risk_meta) — under the full parallel suite they can take the same objects in
  // opposite orders and Postgres kills one. Nothing is wrong with the code when that happens,
  // and the retry is the honest fix: serialising every caller would need an advisory lock in
  // four files that must all remember it, and loosening the assertion would stop it
  // discriminating. Losing a race is a legitimate outcome of a concurrent write; losing it
  // three times running is not.
  //
  // TWO shapes, not one. 40P01 is the deadlock this was first written for. The other is
  // `tuple concurrently updated`, which is what two sessions recreating the SAME view race
  // into — a catalog-tuple update, so Postgres raises it from elog() as XX000 rather than as
  // a serialization failure. Same cause, same remedy, and it is why this test failed roughly
  // one run in two under the full 830-file suite while passing every time on its own.
  //
  // ⚠️ MATCHED ON CODE **AND** MESSAGE. XX000 is `internal_error`, the catch-all Postgres
  // uses for anything raised by a bare elog() — retrying on the code alone would swallow
  // unrelated internal errors and turn a real defect into a slow, silent pass.
  const isRetryable = (e: unknown): boolean => {
    const { code, message } = (e ?? {}) as { code?: string; message?: string };
    return (
      code === "40P01" ||
      (code === "XX000" && /tuple concurrently updated/i.test(message ?? ""))
    );
  };
  const attempt = async (): Promise<void> => {
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        // FIRST, before the REVOKE — see RISK_CACHE_LOCK_KEY.
        await c.query(RISK_CACHE_LOCK_SQL);
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
  };

  for (let tries = 0; ; tries++) {
    try {
      await attempt();
      break;
    } catch (e) {
      if (!isRetryable(e) || tries >= 2) throw e;
      // NOT silent. `rebuild_contract_risk_cache()` has three PRODUCTION callers
      // (load_pg, refresh_risk, kzk_dependents) with a real lock order between them, so a
      // deadlock here can also be a genuine defect rather than test concurrency. Swallowing
      // it without a trace would make that indistinguishable from a busy test run.
      console.warn(
        `retrying after a concurrent-write loss on rebuild_contract_risk_cache() ` +
          `(${(e as { code?: string }).code}, attempt ${tries + 2}/3) — if this appears ` +
          `outside a parallel test run, suspect the production lock order`,
      );
    }
  }

  assert.ok(
    await canSelect("risk_upheld_ocid"),
    "risk_upheld_ocid left unreadable",
  );
});
