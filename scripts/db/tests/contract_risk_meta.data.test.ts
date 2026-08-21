// The provenance stamp on the served risk masks (112, contract_risk_meta).
//
// WHAT IS AT STAKE: the methodology page invites a reader to cite "flag set
// vX.Y.Z". The version compiled into the BUNDLE says what the code declares;
// every flag a reader actually sees came out of contract_risk_cache, built by the
// last rebuild. Those diverge for the whole window between a deploy and a cache
// rebuild — on the cloud side an explicit, easily-skipped operator step. So the
// page reads the stamp, and the stamp has to be trustworthy in BOTH directions:
//
//   - a stamped rebuild records the version it ran under;
//   - an UNSTAMPED rebuild CLEARS the version rather than leaving the previous one
//     standing. A stale stamp is a false claim about which flag set produced the
//     served masks; absence ("not stamped") is the honest alternative.
//
// The second is the one worth a test: it is the behaviour a future tidy-up would
// most plausibly remove, on the reasonable-sounding grounds that clearing a
// version looks like losing information.
//
// COST NOTE — why this file mostly calls contract_risk_stamp() directly rather
// than rebuilding: a full rebuild of the 409k-row cache measures ~36 s locally.
// The first cut drove every assertion through one and took over four minutes to
// test an upsert. The stamping is now its own function, so the semantics are
// exercised instantly and exactly ONE real rebuild proves the wiring.
//
// Skips when Postgres is unreachable, like every *.data.test.ts here.

import { afterAll, describe, expect, test } from "vitest";
import { allRows, dbReachable, end, exec, withClient } from "../lib/pg";
import {
  rebuildRiskCacheSql,
  RISK_CACHE_LOCK_SQL,
} from "../lib/rebuildRiskCache";
import { CATALOG_VERSION } from "../../../src/lib/riskFlagCatalog";

const up = await dbReachable();

afterAll(async () => {
  if (up) await end();
});

type MetaRow = {
  catalog_version: string | null;
  rebuilt_at: string;
  row_count: string | null;
};

const meta = async (): Promise<MetaRow | undefined> =>
  (
    await allRows<MetaRow>(
      `SELECT catalog_version, rebuilt_at, row_count
         FROM contract_risk_meta WHERE only_row`,
    )
  )[0];

/** Stamp directly — the semantics under test, without the 36 s rebuild. */
const stamp = (version: string | null, rows = 1): Promise<void> =>
  exec(
    `SELECT contract_risk_stamp(${version === null ? "NULL" : `'${version}'`}, ${rows})`,
  );

describe.skipIf(!up)("contract_risk_meta — the stamp's semantics", () => {
  test("a version is recorded", async () => {
    await stamp("9.9.9", 42);
    const m = await meta();
    expect(m!.catalog_version).toBe("9.9.9");
    expect(Number(m!.row_count)).toBe(42);
  });

  test("an UNSTAMPED rebuild clears a previous version", async () => {
    // The honesty property, and the one a tidy-up would remove. NULL must
    // OVERWRITE, not be coalesced away.
    await stamp("9.9.9", 42);
    expect((await meta())!.catalog_version).toBe("9.9.9");

    await stamp(null, 42);
    expect(
      (await meta())!.catalog_version,
      "an unstamped rebuild left the previous version standing — the page would " +
        "then cite a flag set the served masks were NOT computed under",
    ).toBeNull();
  });

  test("a blank version is stored as NULL, not as an empty string", async () => {
    // '' would render as a version-shaped nothing on the page instead of taking
    // its "not stamped" branch.
    await stamp("   ", 42);
    expect((await meta())!.catalog_version).toBeNull();
  });

  test("rebuilt_at STRICTLY advances on every stamp", async () => {
    // Compared IN SQL, and strictly.
    //
    // Two traps here, both of which a `toBeGreaterThanOrEqual` on two JS Dates
    // falls into. It is not a real assertion at all: removing rebuilt_at from
    // the upsert's SET list freezes the timestamp permanently and `>=` still
    // passes. And node-postgres truncates a timestamptz to a millisecond Date,
    // so a strict `>` on the JS side flakes whenever two stamps land in the same
    // millisecond — which, at microsecond storage precision, is most of the time.
    // Comparing server-side keeps the full precision and the strictness.
    await stamp("9.9.9", 1);
    const before = (
      await allRows<{ t: string }>(
        "SELECT rebuilt_at::text AS t FROM contract_risk_meta WHERE only_row",
      )
    )[0].t;

    await stamp("9.9.9", 1);
    const [{ advanced }] = await allRows<{ advanced: boolean }>(
      `SELECT (rebuilt_at > $1::timestamptz) AS advanced
         FROM contract_risk_meta WHERE only_row`,
      [before],
    );
    expect(
      advanced,
      "rebuilt_at did not move — the stamp is frozen, so every page would report " +
        "the age of the first rebuild this database ever ran",
    ).toBe(true);
  });

  test("a second row is impossible", async () => {
    // `only_row boolean PRIMARY KEY CHECK (only_row)` — asserted rather than
    // trusted, because a meta table with two rows would let the route pick one.
    await expect(
      exec("INSERT INTO contract_risk_meta (only_row) VALUES (false)"),
    ).rejects.toThrow();
    const [{ n }] = await allRows<{ n: string }>(
      "SELECT count(*)::text AS n FROM contract_risk_meta",
    );
    expect(Number(n)).toBe(1);
  });
});

describe.skipIf(!up)("contract_risk_meta — the wiring", () => {
  test("a bailed-out rebuild does not stamp a version", async () => {
    // The no-arg overload RETURNs 0 without touching the cache when `contracts`
    // or is_direct_award() is missing. The stamped overload must not then claim
    // the masks sitting in the cache came from this catalogue version — it
    // rebuilt nothing. That is the false provenance claim the whole table exists
    // to prevent, and the worst kind, because it looks healthiest.
    //
    // Simulated by renaming is_direct_award inside a transaction that is rolled
    // back, which makes `to_regprocedure(...)` NULL and takes the bail-out
    // branch. Everything runs on ONE client — `exec`/`allRows` check a connection
    // out of the pool per call, so a transaction opened through them would not
    // cover the statements that follow, and the ROLLBACK might land on a
    // different connection than the BEGIN.
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        // FIRST, before the RENAME — see RISK_CACHE_LOCK_KEY. This test hides
        // `is_direct_award`, which the OTHER files' rebuilds call.
        await c.query(RISK_CACHE_LOCK_SQL);
        await c.query("SELECT contract_risk_stamp('0.0.1-before', 7)");
        await c.query(
          "ALTER FUNCTION is_direct_award(text,text) RENAME TO is_direct_award__hidden",
        );

        const bail = await c.query<{ n: string }>(
          "SELECT rebuild_contract_risk_cache('9.9.9')::text AS n",
        );
        expect(
          Number(bail.rows[0].n),
          "the bail-out branch should return 0",
        ).toBe(0);

        const after = await c.query<{ v: string | null }>(
          "SELECT catalog_version AS v FROM contract_risk_meta WHERE only_row",
        );
        expect(
          after.rows[0].v,
          "a rebuild that rebuilt nothing stamped a version anyway — the served " +
            "masks would then be attributed to a flag set that never touched them",
        ).toBe("0.0.1-before");
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });

  // ONE real rebuild. Everything above proves the stamp behaves; this proves the
  // rebuild actually calls it, with the version the TS helper supplies and a
  // count describing the table it was written beside.
  test("a stamped rebuild records CATALOG_VERSION and the real row count", async () => {
    await stamp(null, 0); // start from "not stamped" so a pass cannot be stale
    // Wrapped in an explicit transaction ONLY so the advisory lock has one to live in —
    // `exec()` checks a connection out of the pool per call, so a transaction-scoped lock
    // taken through it would be released before the rebuild ran. See RISK_CACHE_LOCK_KEY.
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query(RISK_CACHE_LOCK_SQL);
        await c.query(rebuildRiskCacheSql());
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    });

    const m = await meta();
    expect(m, "no meta row after a stamped rebuild").toBeTruthy();
    expect(m!.catalog_version).toBe(CATALOG_VERSION);

    const [{ n }] = await allRows<{ n: string }>(
      "SELECT count(*)::text AS n FROM contract_risk_cache",
    );
    expect(Number(m!.row_count)).toBe(Number(n));
    expect(Number(n)).toBeGreaterThan(0);
  }, 120_000);
});
