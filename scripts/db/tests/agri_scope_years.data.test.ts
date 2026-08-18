// AGRI_FINANCIAL_YEARS is the /subsidies year picker AND the whitelist
// agriScopeToKey validates against — so it must be exactly the set of overview
// scopes the loader precomputed. The two drift silently in both directions:
//
//   a year in the list with no payload → the picker offers a scope that serves
//     nothing (the bug this gate was added for);
//   a payload with no year in the list → a covered year is unreachable from the
//     UI, and agriScopeToKey now rejects its deep link as unsupported.
//
// Auto-skips when Postgres is down or agri_payloads is empty, like the other
// *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { AGRI_FINANCIAL_YEARS } from "@/data/agri/constants";

const haveDb = await dbReachable();
const loaded =
  haveDb &&
  (
    await allRows<{ n: string }>(
      "SELECT count(*) n FROM agri_payloads WHERE kind = 'overview'",
    ).catch(() => [{ n: "0" }])
  ).some((r) => Number(r.n) > 0);
const skip = !haveDb
  ? "Postgres unreachable"
  : !loaded
    ? "agri_payloads has no overview rows"
    : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "AGRI_FINANCIAL_YEARS matches the precomputed overview scopes exactly",
  async () => {
    const rows = await allRows<{ key: string }>(
      "SELECT key FROM agri_payloads WHERE kind = 'overview'",
    );
    const keys = new Set(rows.map((r) => r.key));

    // The two non-year singletons the page always needs.
    assert.ok(keys.has(""), "the default (latest-year) overview is missing");
    assert.ok(keys.has("all"), "the all-years overview is missing");

    const built = [...keys]
      .filter((k) => /^\d{4}$/.test(k))
      .map(Number)
      .sort((a, b) => b - a);
    assert.deepEqual(
      built,
      [...AGRI_FINANCIAL_YEARS].sort((a, b) => b - a),
      "the year picker and the precomputed overview scopes disagree",
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §10's last unheld clause: the SEARCH corpus must stay ALL-TIME.
//
// `agri_beneficiary` is what the /subsidies finder queries, and the whole reason it is a
// separate relation from `agri_beneficiary_year` is that the search must never be scoped:
// „вашата фирма не съществува" is a far worse answer than „вашата фирма няма плащания през
// 2025", and /farm/:eik scopes itself. `subsidiesSearch.test.ts` holds the other half — that
// the route's SQL reads this relation and not the year-keyed one — but only Postgres can say
// whether the relation still HAS the shape that makes it all-time.
//
// `idx_agri_beneficiary_eik` (046:135) IS a UNIQUE index, so the plan's wording is right —
// but the 1:1 is derived from the matview's GROUP BY and would hold if that index were
// dropped, so the PROPERTY is what is asserted rather than the constraint.
//
// ⚠️ AND THE COLUMN HALF READS `pg_attribute`, NOT `information_schema.columns`. The first cut
// used the latter and could never fail: information_schema EXCLUDES materialized views
// (measured — 0 rows for this relation against 5 in pg_attribute), so the offender list was
// always empty and the assertion was `[] === []`. The exact „reads as a real test and is
// vacuous" shape the plan warns about, written into the gate meant to prevent it.
test.skipIf(skip)(
  "agri_beneficiary stays one row per ЕИК, with no year dimension",
  async () => {
    const [{ rows, eiks }] = await allRows<{ rows: string; eiks: string }>(
      "SELECT count(*) rows, count(DISTINCT eik) eiks FROM agri_beneficiary",
    );
    assert.ok(Number(rows) > 1000, "agri_beneficiary looks empty");
    assert.equal(
      rows,
      eiks,
      "agri_beneficiary has more rows than ЕИКs — it has grown a second dimension, " +
        "so the finder now returns one row per (eik, something) and its cap silently " +
        "truncates a company's own duplicates instead of showing eight companies",
    );

    const cols = await allRows<{ column_name: string }>(
      `SELECT attname AS column_name FROM pg_attribute
        WHERE attrelid = 'agri_beneficiary'::regclass AND attnum > 0 AND NOT attisdropped`,
    );
    // Non-vacuity: if this ever returns nothing the filter below is trivially satisfied.
    assert.ok(
      cols.length > 2,
      "pg_attribute returned no columns for agri_beneficiary — the probe is broken, " +
        "not the relation, and the scope-column assertion beneath it means nothing",
    );
    const scoped = cols
      .map((c) => c.column_name)
      .filter((c) => /^(year|scope_key|fiscal_year|period)$/.test(c));
    assert.deepEqual(
      scoped,
      [],
      "agri_beneficiary has gained a scope column — the search corpus is becoming " +
        "scope-filtered, which answers „no such company“ to a real one",
    );
  },
);
