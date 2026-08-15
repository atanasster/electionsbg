// Gate for the municipal corpus — WHAT THE STATE SENDS (migration 154).
//
// The failure modes here are all 200s, and in rough order of how badly they
// mislead:
//
//   1. THE TWO CORPORA COMBINED. `budget_muni_*` is what the state sends;
//      `municipal_fiscal` (149) is what municipalities owe. A figure that adds
//      or nets them is wrong in a way no row count will show, and it names 265
//      municipalities while being wrong.
//   2. A PLACE SILENTLY DROPPED. Sofia keys as `SOF` in the Art. 53 corpus and
//      as `SFO_CITY` in place_dim, matching none of its three code columns. An
//      unresolved Sofia is 264/265 = 99.6% placed, which sails past any floor a
//      reasonable person would set while removing the largest municipality in
//      the country from every municipal surface.
//   3. A PARTIAL COVERAGE RENDERED AS NATIONAL. Capital programmes are 26 of
//      265 and execution is 2 of 265. A bare count over either reads as a
//      national figure.
//
// Auto-skips only when Postgres is down, or when 154 has not been applied. An
// EMPTY table is a FAILURE, not a skip: every input is committed and the loader
// is unconditional in db:refresh, so "no rows" means the chain broke.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, dbReachable, end } from "../lib/pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../../..");

const haveDb = await dbReachable();
const applied = haveDb
  ? Number(
      (
        await allRows<{ n: string }>(
          `SELECT count(*)::text n FROM pg_class c
             JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relname = 'budget_muni_transfer'`,
        )
      )[0]?.n ?? 0,
    ) > 0
  : false;

const skip = !haveDb
  ? "Postgres unreachable"
  : !applied
    ? "154 not applied here — run npm run db:load:budget-muni:pg"
    : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "the Art. 53 envelope covers all 265 municipalities, every year",
  async () => {
    // Complete by construction: the State Budget Law names every municipality,
    // so this is the one municipal table with no coverage caveat — and a year
    // that is short is a parse failure, not a gap in the world.
    const rows = await allRows<{ fiscal_year: number; n: string }>(
      `SELECT fiscal_year, count(*)::text n FROM budget_muni_transfer
        GROUP BY fiscal_year ORDER BY fiscal_year`,
    );
    assert.ok(rows.length >= 9, `only ${rows.length} fiscal year(s) loaded`);
    for (const r of rows) {
      assert.equal(Number(r.n), 265, `FY${r.fiscal_year} has ${r.n} of 265`);
    }
  },
);

test.skipIf(skip)("every obshtina code resolves in place_dim", async () => {
  // Sofia is the whole reason this is an equality and not a ratio. See the
  // loader's OBSHTINA_ALIASES for why a floor cannot catch a single miss.
  const orphans = await allRows<{ obshtina: string; tbl: string }>(
    `SELECT DISTINCT obshtina, 'transfer' AS tbl FROM budget_muni_transfer t
      WHERE NOT EXISTS (SELECT 1 FROM place_dim p
                         WHERE p.code = t.obshtina AND p.kind = 'obshtina')
     UNION ALL
     SELECT DISTINCT obshtina, 'ipop' FROM budget_muni_ipop_project t
      WHERE NOT EXISTS (SELECT 1 FROM place_dim p
                         WHERE p.code = t.obshtina AND p.kind = 'obshtina')
     UNION ALL
     SELECT DISTINCT obshtina, 'capital' FROM budget_muni_capital_project t
      WHERE NOT EXISTS (SELECT 1 FROM place_dim p
                         WHERE p.code = t.obshtina AND p.kind = 'obshtina')
     UNION ALL
     SELECT DISTINCT obshtina, 'execution' FROM budget_muni_execution t
      WHERE NOT EXISTS (SELECT 1 FROM place_dim p
                         WHERE p.code = t.obshtina AND p.kind = 'obshtina')`,
  );
  assert.deepEqual(orphans, []);
});

test.skipIf(skip)(
  "Sofia is present and keyed as place_dim knows it",
  async () => {
    // The specific regression: `SOF` in the source, `SFO_CITY` in the dimension,
    // and neither governance_code (SOF00) nor price_code (SOF46) bridges them.
    const [r] = await allRows<{ n: string; total: string | null }>(
      `SELECT count(*)::text n, max(total_eur)::text total
       FROM budget_muni_transfer WHERE obshtina = 'SFO_CITY'`,
    );
    assert.ok(
      Number(r.n) >= 9,
      "Столична община has fewer than 9 transfer years",
    );
    assert.ok(Number(r.total) > 0, "Столична община has no transfer money");
    // …and the raw source key must not have survived into the stored corpus.
    const raw = await allRows<{ obshtina: string }>(
      "SELECT DISTINCT obshtina FROM budget_muni_transfer WHERE obshtina IN ('SOF', 'sofia')",
    );
    assert.deepEqual(raw, []);
  },
);

test.skipIf(skip)(
  "the partial-coverage tables carry the coverage the plan captions them with",
  async () => {
    // §8.2's three tiles each declare a different denominator, and each of
    // these is the number that caption must be built from — not a bare count.
    const [ipop] = await allRows<{
      munis: string;
      projects: string;
      stalled: string;
    }>(
      `SELECT count(DISTINCT obshtina)::text munis, count(*)::text projects,
              count(*) FILTER (WHERE stalled)::text stalled
         FROM budget_muni_ipop_project`,
    );
    assert.equal(Number(ipop.munis), 264);
    assert.equal(Number(ipop.projects), 3492);
    // Tracks the МРРБ execution CSV, which is re-exported daily — `stalled`
    // moves whenever payments land (769 → 700 on the 2026-08-14 refresh, as more
    // projects crossed the 5%-paid line). Re-pin after an ipop ingest; a change
    // here is the corpus moving, not the load failing.
    assert.equal(Number(ipop.stalled), 700);

    const [cap] = await allRows<{ munis: string }>(
      "SELECT count(DISTINCT obshtina)::text munis FROM budget_muni_capital_project",
    );
    // 26 of 265 — and NOT „oblast centres": six of them are not (Асеновград,
    // Велинград, Дупница, Казанлък, Карлово, Самоков) and seven centres are
    // missing. A caption here names the count, never the category.
    assert.equal(Number(cap.munis), 26);

    const [exe] = await allRows<{ munis: string }>(
      "SELECT count(DISTINCT obshtina)::text munis FROM budget_muni_execution",
    );
    // 2 of 265 — a pilot, which is why the hub gives it no tile.
    assert.equal(Number(exe.munis), 2);
  },
);

// NOT skipIf(skip): this is a SOURCE-level check and needs no database, so
// guarding it behind Postgres would take the file's stated failure mode #1 —
// the two corpora combined — green on every checkout without one. The sibling
// reload_visibility_map.data.test.ts runs its source check unguarded for the
// same reason.
test("154 never reads municipal_fiscal — the two corpora stay apart", () => {
  // The boundary, asserted on the SOURCE rather than on the data, because a
  // join that should not exist leaves no trace in the rows.
  const sql = readFileSync(
    resolve(REPO, "scripts/db/schema/pg/154_budget_municipal.sql"),
    "utf8",
  );
  const loader = readFileSync(
    resolve(REPO, "scripts/db/load_budget_muni_pg.ts"),
    "utf8",
  );
  // Both NAME it — in prose and in a COMMENT ON string, which is where 154
  // states the boundary. What neither may do is QUERY it, so the check is on
  // the shapes that read a table rather than on any mention of the word.
  // `municipal_fiscal\b` would MISS municipal_fiscal_by_obshtina() and its
  // two siblings, because \b does not fire between "l" and "_". Neither file
  // may call those either — §8.3 says a LATER tier reuses the ranker, not
  // this one.
  const READS =
    /\b(from|join|update|into|delete\s+from)\s+municipal_fiscal|municipal_fiscal_(by_obshtina|ranking|national)\s*\(/i;
  for (const [what, src] of [
    ["154", sql],
    ["the loader", loader],
  ] as const) {
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(--|\/\/|\*|\/\*)/.test(l))
      .join("\n");
    assert.ok(
      !READS.test(code),
      `${what} QUERIES municipal_fiscal — the two municipal corpora are what the ` +
        "state SENDS vs what municipalities OWE, and must never be joined or summed",
    );
  }
  // …and the check must not be vacuous: it has to fire on a real query.
  for (const probe of [
    "SELECT x FROM municipal_fiscal WHERE y",
    "SELECT municipal_fiscal_ranking(2024, 10)",
  ]) {
    assert.ok(READS.test(probe), `the read-detector missed: ${probe}`);
  }
});

test.skipIf(skip)(
  "no money column is numeric — node-postgres would serialise it as a string",
  async () => {
    const bad = await allRows<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name LIKE 'budget\\_muni\\_%'
          AND data_type = 'numeric'`,
    );
    assert.deepEqual(bad, []);
  },
);

test.skipIf(skip)(
  "the published total is stored, not re-derived from its parts",
  async () => {
    // 154 stores the law's own total rather than summing the five kinds, so a
    // disagreement is visible. This gate asserts the total EXISTS and is not
    // merely the sum — if it ever became the sum, the disagreement it exists to
    // surface would be undetectable.
    const [r] = await allRows<{
      rows: string;
      withtotal: string;
      differ: string;
    }>(
      `SELECT count(*)::text rows,
              count(total_eur)::text withtotal,
              count(*) FILTER (
                WHERE total_eur IS DISTINCT FROM
                  coalesce(delegated_eur,0) + coalesce(equalization_eur,0)
                  + coalesce(capital_eur,0) + coalesce(winter_eur,0)
                  + coalesce(other_targeted_eur,0)
              )::text differ
         FROM budget_muni_transfer`,
    );
    assert.ok(Number(r.rows) > 0, "budget_muni_transfer is empty");
    assert.equal(r.withtotal, r.rows, "some row has no published total");
    // The published total and the five kinds AGREE on every row — measured, the
    // only differences are €1-2 of per-component euro rounding on 848 of 2,385.
    // (An earlier draft asserted they must differ, on the theory that a `basic`
    // component sat outside the five; it does not exist at município grain.)
    // So the assertion is the reconciliation itself: a drift beyond rounding
    // means the loader started deriving the total instead of reading it.
    assert.ok(
      Number(r.differ) <= Number(r.rows) * 0.5,
      `${r.differ} of ${r.rows} rows disagree with the sum of their parts by more than ` +
        "rounding — the published total and its components should reconcile",
    );
  },
);
