// Tier 3 (Postgres-native) — durable integrity invariants over the loaded
// `contracts` table. The PG port of invariants.data.test.ts: instead of streaming
// the on-disk month shards, it asserts the same data-version-independent rules
// straight in SQL, so the standing regression net survives the derived-JSON
// retirement (docs/plans/direct-db-ingest-v1.md §5). Checks: contract `key` is
// globally unique, the EUR peg holds on convertible rows, and zero synthetic
// "-x" legacy-twin survivors coexist with a real twin.
//
//   npm run test:data   (or DB_VERIFY=1 npm run db:verify)
//
// Requires the Postgres store (`npm run db:pg:up` + `db:load:pg`); auto-skips when
// Postgres is unreachable or the contracts table is absent — so CI (no container,
// no corpus) skips it, exactly like search.data.test.ts / pg_roundtrip.
//
// The headline Σ(amount_eur) ↔ index.json reconciliation lives in
// pg_roundtrip.data.test.ts; this file owns the internal-consistency invariants.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

// BGN → EUR peg. Kept in sync with src/lib/currency.ts (BGN_PER_EUR) + the
// convertible-currency aliases in scripts/db/lib/contracts_aggregate.ts.
const BGN_PER_EUR = 1.95583;

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.contracts') IS NOT NULL AS ok",
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / contracts table absent";

after(async () => {
  await end();
});

test("contract keys are globally unique", { skip }, async () => {
  const [r] = await allRows<{ dup: string }>(
    "SELECT (count(*) - count(DISTINCT key))::text AS dup FROM contracts",
  );
  const sample = await allRows<{ key: string; n: number }>(
    `SELECT key, count(*)::int AS n FROM contracts
     GROUP BY key HAVING count(*) > 1 ORDER BY n DESC, key LIMIT 5`,
  );
  assert.equal(
    Number(r.dup),
    0,
    `duplicate contract key(s), e.g. ${sample
      .map((s) => `${s.key}×${s.n}`)
      .join(", ")} — see disambiguateContractKeys in contract_key.ts`,
  );
});

test("EUR peg (1.95583) holds on convertible rows", { skip }, async () => {
  const rows = await allRows<{
    key: string;
    currency: string;
    amount: number;
    amount_eur: number;
    signing_amount_eur: number | null;
  }>(
    // The peg holds on the AT-SIGNING euro value, which pegs to the native
    // `amount`. For annexed rows the headline `amount_eur` is the CURRENT
    // (post-annex) value and deliberately no longer pegs — `signing_amount_eur`
    // preserves the peggable value (NULL ⇒ amount_eur IS the signing value). So
    // check COALESCE(signing_amount_eur, amount_eur), matching the authoritative
    // canary in scripts/db/lib/contracts_aggregate.ts. Checking amount_eur alone
    // false-flagged all ~7.8k folded rows (the current-value fold, migration 078).
    `SELECT key, currency, amount, amount_eur, signing_amount_eur
     FROM contracts
     WHERE amount IS NOT NULL AND amount_eur IS NOT NULL AND currency IS NOT NULL
       AND (
         (upper(btrim(currency)) = 'EUR'
            AND abs(COALESCE(signing_amount_eur, amount_eur) - amount) > 0.01)
         OR (upper(btrim(currency)) IN ('BGN', 'ЛВ', 'ЛВ.', 'ЛЕВА')
            AND abs(COALESCE(signing_amount_eur, amount_eur) - amount / ${BGN_PER_EUR}) > 0.01)
       )
     LIMIT 25`,
  );
  assert.equal(
    rows.length,
    0,
    `amount_eur diverges from the locked peg, e.g. ${JSON.stringify(
      rows[0],
    )} — see src/lib/currency.ts`,
  );
});

test("no synthetic legacy -x twin survivors", { skip }, async () => {
  // A row whose ocid ends in "-x" (synthetic legacy twin) must NOT share its
  // (date, awarder, contractor, amount, title) identity with a real (non-x) row
  // — that would double-count the spend. Same twin key as contracts_aggregate.ts.
  const [r] = await allRows<{ survivors: string }>(
    `WITH tk AS (
       SELECT
         (ocid LIKE '%-x') AS is_x,
         concat_ws('|', coalesce(date::text, ''), coalesce(awarder_eik, ''),
                   coalesce(contractor_eik, ''), coalesce(amount::text, ''),
                   coalesce(title, '')) AS twin
       FROM contracts
     ),
     x AS (SELECT DISTINCT twin FROM tk WHERE is_x),
     real AS (SELECT DISTINCT twin FROM tk WHERE NOT is_x)
     SELECT count(*)::text AS survivors FROM x JOIN real USING (twin)`,
  );
  const sample = await allRows<{ key: string }>(
    `SELECT key FROM contracts WHERE ocid LIKE '%-x' LIMIT 5`,
  );
  assert.equal(
    Number(r.survivors),
    0,
    `${r.survivors} "-x" twin identit(ies) coexist with a real twin (double-counts ` +
      `spend) — see dropSyntheticLegacyTwins in validate.ts. Sample x-keys: ${sample
        .map((s) => s.key)
        .join(", ")}`,
  );
});
