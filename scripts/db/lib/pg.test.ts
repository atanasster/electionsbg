// Unit + Tier-3 coverage for `vacuumAfterReload` and the threshold it shares with the
// `reload_visibility_map` gate.
//
//   npm run test:unit          (the pure predicate cases — no database)
//   npm run test:data          (the read-back cases — auto-skip without Postgres)
//
// WHY THIS FILE EXISTS: the gate over in tests/ asserts nine tables and passes on a
// healthy database, which proves nothing about whether the check CAN fail. If a refactor
// made `visibilityMapShort` always return false, or made the shortfall query never match,
// every run there would stay green and the gate would be vacuous. The predicate cases
// below are the mutation check — they pin both sides of the boundary against measured
// numbers, so "the check still discriminates" is asserted rather than assumed.
//
// The read-back cases cover the only genuinely new logic in the helper: the shortfall
// warning. Its failure mode is a warning that never prints, which is indistinguishable
// from success — exactly the invisibility the whole change exists to end.

import { describe, test, expect, afterAll, vi } from "vitest";
import assert from "node:assert/strict";
import {
  allRows,
  dbReachable,
  end,
  getPool,
  vacuumAfterReload,
  vacuumRepairSql,
  visibilityMapShort,
  withClient,
} from "./pg";

describe("visibilityMapShort", () => {
  // Every number here was measured on the local corpus (2026-08-11), so a future
  // recalibration has to argue with real tables rather than with invented ones.
  test.each([
    // [relpages, relallvisible, short?, what it is]
    [527, 0, true, "nzok_activities in the defect state"],
    [8780, 0, true, "fund_projects before fdbdca7869"],
    [42072, 0, true, "tenders before this fix"],
    [42072, 42071, false, "tenders after — one trailing page short"],
    [120624, 102366, false, "contracts, healthy at 84.9% under update churn"],
    [2971, 2213, false, "contract_first_seen, healthy at 74.5%"],
    [1174, 809, false, "graph_company_node, healthy at 68.9%"],
    [567, 483, false, "tender_dossier, healthy at 85.2%"],
    [3, 0, true, "small table, nothing marked"],
    [3, 2, false, "small table, one trailing page"],
    [0, 0, false, "empty table has nothing to mark"],
  ])("%i/%i → short=%s (%s)", (relpages, relallvisible, expected) => {
    expect(
      visibilityMapShort(relpages as number, relallvisible as number),
    ).toBe(expected);
  });

  test("the 90% bar this replaced would have rejected healthy tables", () => {
    // The reason for the recalibration, kept as an assertion so it cannot be quietly
    // reverted: `contracts` is the standing proof that a map SURVIVES a reload, and it
    // sits below 90%. A gate that fires on it gets muted, which costs the whole file.
    const old = (p: number, v: number) => v < p * 0.9;
    expect(old(120624, 102366)).toBe(true); // would have fired
    expect(visibilityMapShort(120624, 102366)).toBe(false); // does not
  });

  test("still rejects an empty map on every table size that can hold one", () => {
    // The defect is always relallvisible = 0. Whatever else the threshold tolerates, it
    // must never tolerate that — checked across three orders of magnitude.
    for (const pages of [3, 10, 100, 527, 8780, 42072, 120624])
      expect(visibilityMapShort(pages, 0)).toBe(true);
  });
});

describe("vacuumRepairSql", () => {
  test("always carries PARALLEL 0", () => {
    // Not cosmetic: without it the command dies on the docker Postgres (64 MB /dev/shm)
    // for exactly the table most likely to need repairing. Three hand-written copies had
    // already dropped it, which is why there is now one spelling.
    expect(vacuumRepairSql("tenders")).toBe(
      "VACUUM (ANALYZE, PARALLEL 0) tenders;",
    );
    expect(vacuumRepairSql("a", "b")).toBe(
      "VACUUM (ANALYZE, PARALLEL 0) a, b;",
    );
  });
});

const haveDb = await dbReachable();
const skip = haveDb ? false : "Postgres unreachable";

afterAll(async () => {
  if (haveDb) await end();
});

/** Any transaction holding the xmin horizon back — the condition under which VACUUM
 *  legitimately marks nothing. The happy-path test below cannot run while one exists,
 *  and that is a property of the environment rather than of the code: a `db:refresh`,
 *  a `db:resolve:persons` or ordinary serving traffic all produce it. Checked instead
 *  of assumed, so the test skips with a reason rather than failing spuriously — which
 *  it did on the first run, against a 19-minute resolve nobody had mentioned. */
const horizonHolder = async (): Promise<number | null> => {
  if (!haveDb) return null;
  const [row] = await allRows<{ pid: number }>(
    `SELECT pid FROM pg_stat_activity
      WHERE backend_xmin IS NOT NULL AND pid <> pg_backend_pid() LIMIT 1`,
  ).catch(() => []);
  return row?.pid ?? null;
};

describe("vacuumAfterReload", () => {
  test("rejects an unsafe identifier before issuing any VACUUM", async () => {
    // Validation must precede the first side effect, or a bad name in position two
    // throws only after position one has already been vacuumed (2.5 s on tenders) and
    // the caller cannot treat the throw as "nothing happened".
    //
    // The ordering is what is under test, so the first name is one Postgres would
    // REJECT: if any VACUUM ran before validation, the error surfacing here would be
    // 42P01 "relation does not exist" rather than the identifier message. That makes
    // the assertion a discriminator rather than a restatement.
    await assert.rejects(
      () => vacuumAfterReload("no_such_table_xyz", "bad-name"),
      (e: Error) => {
        assert.match(e.message, /unsafe identifier "bad-name"/);
        assert.doesNotMatch(e.message, /does not exist/);
        return true;
      },
    );
  });

  test.skipIf(skip)("stays silent when the map fills", async (ctx) => {
    const blocked = await horizonHolder();
    if (blocked !== null)
      return ctx.skip(
        `pid ${blocked} is holding the xmin horizon, so VACUUM cannot mark anything ` +
          `on this database right now — the sibling test covers that case`,
      );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await withClient(async (c) => {
        await c.query("DROP TABLE IF EXISTS vm_probe_ok");
        await c.query("CREATE TABLE vm_probe_ok (i int)");
        await c.query(
          "INSERT INTO vm_probe_ok SELECT generate_series(1, 50000)",
        );
      });
      await vacuumAfterReload("vm_probe_ok");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await withClient((c) => c.query("DROP TABLE IF EXISTS vm_probe_ok"));
    }
  });

  test.skipIf(skip)(
    "warns and names the blocking pid when the map stays short",
    async () => {
      // Reproduces the measured case: a concurrent snapshot older than the reload means
      // VACUUM can mark nothing, reports success anyway, and the loader exits 0. This is
      // the one path that makes the helper's own failure visible, so it is asserted
      // rather than trusted.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const blocker = await getPool().connect();
      try {
        await withClient(async (c) => {
          await c.query("DROP TABLE IF EXISTS vm_probe_short");
          await c.query("CREATE TABLE vm_probe_short (i int)");
        });
        // Hold a snapshot open FIRST, so it predates the rows written below.
        await blocker.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await blocker.query("SELECT 1");

        await withClient(async (c) => {
          await c.query("BEGIN");
          await c.query(
            "INSERT INTO vm_probe_short SELECT generate_series(1, 50000)",
          );
          await c.query("COMMIT");
        });

        await vacuumAfterReload("vm_probe_short");

        expect(warn).toHaveBeenCalledOnce();
        const msg = String(warn.mock.calls[0]?.[0] ?? "");
        assert.match(msg, /visibility map short on vm_probe_short \(0\//);
        assert.match(msg, /pid \d+ has held a snapshot open for/);
        // and it hands over a command that actually runs on this machine
        assert.match(msg, /VACUUM \(ANALYZE, PARALLEL 0\) vm_probe_short;/);
      } finally {
        warn.mockRestore();
        await blocker.query("ROLLBACK").catch(() => {});
        blocker.release();
        await withClient((c) => c.query("DROP TABLE IF EXISTS vm_probe_short"));
      }
    },
  );
});
