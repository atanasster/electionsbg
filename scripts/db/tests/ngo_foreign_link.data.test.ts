// Tier 3 (Postgres-native) — structural invariants over the contract-page
// foreign-funding disclosure feed (`procurement_ngo_foreign_link`, populated by
// rebuild_procurement_ngo_foreign_link() in migration 080). Data-version-
// independent rules that lock the rebuild's shape:
//   - 'direct' rows are self-referential (ngo_eik = eik, no person);
//     'connected' rows point at a DIFFERENT NGO and name the board member.
//   - every listed NGO actually has FOREIGN funding (eu_fts / abf / ned) — a
//     domestic budget_subsidy alone must never surface here.
//   - the DISTINCT ON (eik) dedup holds: each contractor eik appears once, and
//     when an eik qualifies both ways it is tagged 'direct' (direct beats
//     connected), never 'connected'.
//
//   npm run test:data
//
// Auto-skips when Postgres is unreachable or the table is absent (fresh CI
// checkout / TR-only DB), exactly like invariants_pg.data.test.ts.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.procurement_ngo_foreign_link') IS NOT NULL AS ok",
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / link table absent";

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "direct rows are self-referential; connected rows are not",
  async () => {
    const bad = await allRows<{ eik: string; kind: string }>(
      `SELECT eik, kind FROM procurement_ngo_foreign_link
     WHERE (kind = 'direct'    AND (ngo_eik <> eik OR person IS NOT NULL))
        OR (kind = 'connected' AND (ngo_eik  = eik OR person IS NULL))
        OR kind NOT IN ('direct','connected')
     LIMIT 5`,
    );
    assert.equal(
      bad.length,
      0,
      `rows violating the direct/connected shape: ${JSON.stringify(bad)}`,
    );
  },
);

test.skipIf(skip)(
  "every listed NGO has foreign funding (no budget_subsidy-only)",
  async () => {
    // Each row's ngo_eik must have at least one eu_fts/abf/ned funding row.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n
     FROM procurement_ngo_foreign_link l
     WHERE NOT EXISTS (
       SELECT 1 FROM ngo_funding f
       WHERE f.eik = l.ngo_eik AND f.source IN ('eu_fts','abf','ned')
     )`,
    );
    assert.equal(
      Number(r.n),
      0,
      "found link rows whose NGO has no foreign funding",
    );
  },
);

test.skipIf(skip)(
  "dedup holds: one row per contractor eik, direct beats connected",
  async () => {
    const [dup] = await allRows<{ dup: string }>(
      "SELECT (count(*) - count(DISTINCT eik))::text AS dup FROM procurement_ngo_foreign_link",
    );
    assert.equal(Number(dup.dup), 0, "an eik appears more than once");

    // If an eik is itself a foreign-funded NGO winning contracts (i.e. eligible
    // for 'direct'), it must be tagged 'direct', never 'connected'.
    const wrong = await allRows<{ eik: string }>(
      `SELECT l.eik
     FROM procurement_ngo_foreign_link l
     WHERE l.kind = 'connected'
       AND EXISTS (
         SELECT 1 FROM ngo_funding f
         WHERE f.eik = l.eik AND f.source IN ('eu_fts','abf','ned')
       )
       AND EXISTS (
         SELECT 1 FROM contracts ct
         WHERE ct.tag = 'contract' AND ct.contractor_eik = l.eik
       )
     LIMIT 5`,
    );
    assert.equal(
      wrong.length,
      0,
      `eiks eligible for 'direct' but tagged 'connected': ${JSON.stringify(wrong)}`,
    );
  },
);
