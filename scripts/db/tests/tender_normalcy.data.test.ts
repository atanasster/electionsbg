// Tier 3 (Postgres-native) — parity + sanity invariants for the tender normalcy
// stack (migration 067). Locks the property the whole design rests on: the
// SET-BASED cache matview (tender_normalcy_cache) is byte-identical to the live
// reference function (tender_normalcy(unp)) it precomputes — so the route's
// cache-first fast path and its live fallback can never diverge.
//
//   npm run test:data
//
// Requires the Postgres store with tenders loaded (`db:load:tenders:pg`, which
// applies 066). Auto-skips when Postgres or the tenders table is unreachable, so
// CI without a container/corpus skips it, exactly like invariants_pg.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.tender_normalcy_cache') IS NOT NULL AS ok",
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / tender_normalcy_cache absent";

afterAll(async () => {
  if (haveDb) await end();
});

// A representative УНП sample: cpv-bearing, cpv-less, short-window (deviation),
// and cancelled — the shapes most likely to diverge between the two builds.
test.skipIf(skip)(
  "tender_normalcy() == tender_normalcy_cache (byte parity)",
  async () => {
    const [r] = await allRows<{ checked: number; mismatch: number }>(`
    WITH samp AS (
      (SELECT unp FROM tenders WHERE cpv IS NOT NULL ORDER BY unp LIMIT 60)
      UNION (SELECT unp FROM tenders WHERE cpv IS NULL LIMIT 10)
      UNION (SELECT unp FROM tenders
             WHERE tender_window_days(publication_date, submission_deadline) < 14 LIMIT 20)
      UNION (SELECT unp FROM tenders WHERE is_cancelled LIMIT 10)
    )
    SELECT count(*)::int AS checked,
           count(*) FILTER (
             WHERE tender_normalcy(s.unp)::text <> c.payload::text)::int AS mismatch
    FROM samp s JOIN tender_normalcy_cache c USING (unp)`);
    assert.ok(r.checked > 50, `expected a real sample, got ${r.checked}`);
    assert.equal(
      r.mismatch,
      0,
      `${r.mismatch} of ${r.checked} payloads diverged`,
    );
  },
);

// Percentiles are shares in [0,1]; the window signal must actually be present and
// fire on some tenders (else the panel would be a dead tile).
test.skipIf(skip)("tender_normalcy payloads are well-formed", async () => {
  const [r] = await allRows<{
    bad_pct: number;
    with_window: number;
    firing: number;
  }>(`
    SELECT
      count(*) FILTER (WHERE (payload->'window'->>'percentile')::numeric NOT BETWEEN 0 AND 1
                          OR (payload->'value'->>'percentile')::numeric NOT BETWEEN 0 AND 1)::int AS bad_pct,
      count(*) FILTER (WHERE payload->'window' <> 'null'::jsonb)::int AS with_window,
      count(*) FILTER (WHERE (payload->'window'->>'percentile')::numeric <= 0.1
                          AND (payload->'window'->>'n')::int >= 20)::int AS firing
    FROM tender_normalcy_cache`);
  assert.equal(r.bad_pct, 0, "percentiles must be shares in [0,1]");
  assert.ok(
    r.with_window > 10000,
    `window signal too sparse: ${r.with_window}`,
  );
  assert.ok(r.firing > 0, "no short-window deviations fire — signal is dead");
});
