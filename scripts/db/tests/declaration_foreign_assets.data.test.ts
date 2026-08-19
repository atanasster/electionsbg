// Gate for „чуждо имущество" — the two declaration tables that are NOT holdings.
//
// THE RULE. Tables 1.2 („Чуждо недвижимо имущество") and 3.4 („Чужди моторни сухопътни,
// водни и въздухоплавателни превозни средства") record property and vehicles owned by
// SOMEBODY ELSE that the declarant rents or has been provided with. The register's own
// column headers are what settle it: their money column is „Цена по договор" against table
// 1/3's „Цена на придобиване", and their basis column „Правно основание за ползване"
// against „…за придобиване". So the figure beside such a row is what the USE costs — it is
// not a mis-attributed asset value, and no net worth may contain it.
//
// WHY THIS TEST. Before the provenance existed, €69.5m across 5,183 rows was published as
// declared wealth, €58.7m of it reaching person_wealth_year: 1,306 people, of whom 106 had
// a published estate ≥90% other people's property and one was at 100%. Nothing caught it —
// every row count reconciled, no page errored, and the /officials/assets top 100 did not
// move at all, because the largest fortunes are dominated by genuine holdings. The damage
// was entirely per-profile, which is the shape no aggregate check can see.
//
// The rule exists TWICE — is_declared_holding() in 089_declarations.sql and
// isDeclaredHolding() in src/lib/declarations.ts — because a route cannot import TS. Same
// structural duplication as asset_share_multiplier, and the same gate shape.
//
// Auto-skips when Postgres is down or the corpus is empty.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { isDeclaredHolding } from "../../../src/lib/declarations";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.declaration_asset') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration_asset",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

// A database whose corpus predates the backfill has table_num NULL everywhere. That is a
// legitimate state — is_declared_holding reads NULL as a holding, so such a database serves
// exactly what it served before — but every assertion below would then pass vacuously. Skip
// with a distinct reason instead, so "the corpus has no provenance yet" can never be
// mistaken for "the rule is enforced".
const stamped = async (): Promise<boolean> => {
  const [c] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM declaration_asset WHERE table_num IS NOT NULL",
  );
  return Number(c.n) > 0;
};

const haveDb = await reachable();
const haveProvenance = haveDb ? await stamped() : false;
const skip = !haveDb
  ? "Postgres unreachable / declaration_asset empty"
  : !haveProvenance
    ? "declaration_asset.table_num is entirely NULL — run scripts/declarations/backfill_asset_table_num.ts --apply, then reload"
    : false;

afterAll(async () => {
  await end();
});

// ---------------------------------------------------------------------------
// 1. Lockstep. Every DISTINCT table_num the corpus actually holds, run through both
//    implementations — not a hand-picked list, so a subtable added by a future form
//    revision reaches this the next time declarations load.
// ---------------------------------------------------------------------------
test.skipIf(skip)(
  "SQL and TS agree on every table_num in the corpus",
  async () => {
    const rows = await allRows<{ table_num: string | null; sql_h: boolean }>(
      `SELECT table_num, is_declared_holding(table_num) AS sql_h
         FROM (SELECT DISTINCT table_num FROM declaration_asset) d
        ORDER BY table_num`,
    );
    assert.ok(rows.length > 1, "only one distinct table_num — corpus stamped?");

    const disagreements = rows
      .filter((r) => isDeclaredHolding({ tableNum: r.table_num }) !== r.sql_h)
      .map(
        (r) =>
          `${JSON.stringify(r.table_num)}: TS ${isDeclaredHolding({ tableNum: r.table_num })} vs SQL ${r.sql_h}`,
      );
    assert.deepEqual(
      disagreements,
      [],
      `isDeclaredHolding() and is_declared_holding() disagree:\n  ${disagreements.join("\n  ")}`,
    );
  },
);

// NULL must be a HOLDING on both sides. This is the one input whose wrong answer is
// catastrophic rather than merely wrong: every row on a not-yet-reloaded database carries
// it, so reading NULL as "not a holding" deletes every real asset from every figure at
// once. Asserted directly rather than left to the corpus sweep, which sees NULL only while
// a partial reload happens to leave some.
test.skipIf(skip)("a NULL table_num is a holding on both sides", async () => {
  const [r] = await allRows<{ sql_h: boolean }>(
    "SELECT is_declared_holding(NULL) AS sql_h",
  );
  assert.equal(r.sql_h, true, "SQL treats an unstamped row as a non-holding");
  assert.equal(
    isDeclaredHolding({ tableNum: null }),
    true,
    "TS treats an unstamped row as a non-holding",
  );
  assert.equal(isDeclaredHolding({}), true, "TS mishandles a missing tableNum");
});

// ---------------------------------------------------------------------------
// 2. Non-vacuity. The rule must have something to bite on.
// ---------------------------------------------------------------------------
test.skipIf(skip)("the corpus contains чуждо rows", async () => {
  const [c] = await allRows<{ n: string; eur: string | null }>(
    `SELECT count(*) n, round(SUM(value_eur))::text eur
       FROM declaration_asset WHERE NOT is_declared_holding(table_num)`,
  );
  assert.ok(
    Number(c.n) > 1000,
    `only ${c.n} чуждо rows — has the parser stopped recording table_num?`,
  );
});

// ---------------------------------------------------------------------------
// 3. The matview actually excludes them — and the exclusion MOVES the number.
//
//    The second half is the mutation check. An assertion that person_wealth_year equals a
//    filtered recompute is satisfied by any pair of expressions that agree, including two
//    that both forgot the filter; comparing against the UNfiltered recompute is what proves
//    the predicate discriminates on this corpus.
// ---------------------------------------------------------------------------
test.skipIf(skip)(
  "person_wealth_year sums holdings only, and that is a real difference",
  async () => {
    const rows = await allRows<{
      person_id: string;
      published: string;
      filtered: string;
      unfiltered: string;
    }>(
      `WITH recompute AS (
         SELECT w.person_id, w.declaration_id, w.assets_eur AS published,
                COALESCE(SUM(a.value_eur * asset_share_multiplier(a.share, a.category))
                  FILTER (WHERE a.category NOT IN ('debt','credit_limit')
                            AND a.value_eur <= asset_row_ceiling_eur()
                            AND is_declared_holding(a.table_num)), 0) AS filtered,
                COALESCE(SUM(a.value_eur * asset_share_multiplier(a.share, a.category))
                  FILTER (WHERE a.category NOT IN ('debt','credit_limit')
                            AND a.value_eur <= asset_row_ceiling_eur()), 0) AS unfiltered
           FROM person_wealth_year w
           LEFT JOIN declaration_asset a ON a.declaration_id = w.declaration_id
          GROUP BY w.person_id, w.declaration_id, w.assets_eur
       )
       SELECT person_id::text, published::text, filtered::text, unfiltered::text
         FROM recompute
        WHERE abs(published - filtered) > 0.01 OR unfiltered > filtered + 0.01
        ORDER BY unfiltered - filtered DESC`,
    );

    const wrong = rows
      .filter((r) => Math.abs(Number(r.published) - Number(r.filtered)) > 0.01)
      .map(
        (r) =>
          `person ${r.person_id}: published ${r.published} vs holdings-only ${r.filtered}`,
      );
    assert.deepEqual(
      wrong,
      [],
      `person_wealth_year.assets_eur includes non-holdings for ${wrong.length} person-years:\n  ${wrong.slice(0, 15).join("\n  ")}`,
    );

    // …and the filter is not a no-op: many person-years must differ from the unfiltered sum.
    const moved = rows.filter(
      (r) => Number(r.unfiltered) > Number(r.filtered) + 0.01,
    );
    assert.ok(
      moved.length > 100,
      `only ${moved.length} person-years change when the holding filter is removed — ` +
        `the predicate has stopped discriminating (a vacuous pass).`,
    );
  },
);

// ---------------------------------------------------------------------------
// 4. The worked example, by name. The abstract assertions above stay true if the two
//    table numbers are ever swapped for two harmless ones; this does not.
// ---------------------------------------------------------------------------
test.skipIf(skip)(
  "Пеевски's 2025 estate excludes the rented houses and provided cars",
  async () => {
    const rows = await allRows<{
      published: string;
      used_rows: string;
      used_eur: string;
    }>(
      `SELECT w.assets_eur::text AS published,
              count(a.*) FILTER (WHERE NOT is_declared_holding(a.table_num))::text AS used_rows,
              COALESCE(round(SUM(a.value_eur)
                FILTER (WHERE NOT is_declared_holding(a.table_num))), 0)::text AS used_eur
         FROM declaration d
         JOIN person_wealth_year w ON w.declaration_id = d.declaration_id
         LEFT JOIN declaration_asset a ON a.declaration_id = d.declaration_id
        WHERE d.source_url LIKE '%0B5F88E9-F9D9-4D6A-96C5-DE597BCE76B6241314.xml'
        GROUP BY w.assets_eur`,
    );
    // The filing is only present on a corpus that has ingested the 2026 register folder.
    if (rows.length === 0) return;
    const [r] = rows;
    assert.equal(
      r.used_rows,
      "13",
      `expected 13 чуждо rows (8 rented properties + 5 provided cars), got ${r.used_rows}`,
    );
    // €233,109 property + €77,307 vehicles. Asserted as a band, not to the cent: the
    // euro values ride the locked peg and a future re-parse may re-read a cell.
    const used = Number(r.used_eur);
    assert.ok(
      used > 300_000 && used < 320_000,
      `чуждо contract prices should total ~€310,416, got ${used}`,
    );
    // The published estate must be the €9.76m, not the €10.07m that included them.
    const published = Number(r.published);
    assert.ok(
      published > 9_600_000 && published < 9_900_000,
      `expected ~€9,760,147 of owned assets, got ${published} — ` +
        `${published > 10_000_000 ? "the чуждо rows are still being counted" : "unexpected"}`,
    );
  },
);

// ---------------------------------------------------------------------------
// 5. Exhaustiveness. A NEW surface that sums declared values must decide, rather than
//    silently inheriting the old behaviour. Same shape as the declared_label sweep.
// ---------------------------------------------------------------------------
const HOLDING_FILTER_EXCEPTIONS: Record<string, string> = {
  // EMPTY, and that is the finding: every object the sweep below reaches already routes
  // through the predicate. The mechanism stays so a future surface can be exempted WITH A
  // REASON rather than by loosening the query.
  //
  // Two candidates were considered and are correctly out of scope rather than exempt:
  //   * person_crypto_table (159) reads declaration_asset but aggregates nothing — the sum
  //     happens in the DbDataTable engine at query time — and its rows are table 8, which
  //     has no чуждо counterpart on either form. It also joins THROUGH person_wealth_year.
  //   * mp_car (104) is COPYed from mp-cars.json; the filter lives in build_car_makes.ts,
  //     where it drops 612 чужди vehicle rows. See 104's header for why the TS builder
  //     stays canonical.
};

test.skipIf(skip)(
  "every object that sums declared assets routes through is_declared_holding or is a named exception",
  async () => {
    const rows = await allRows<{ obj: string; kind: string; routes: boolean }>(
      `WITH defs AS (
         SELECT c.relname AS obj, c.relkind::text AS kind, pg_get_viewdef(c.oid) AS src
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('m', 'v')
         UNION ALL
         SELECT p.proname, 'f', pg_get_functiondef(p.oid)
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.prokind = 'f'
       ), clean AS (
         -- Comments are stored verbatim in a body, and 089/090 discuss these tables in
         -- prose precisely to warn about them. Strip comments before deciding, or the
         -- warning trips the gate it was written to support.
         SELECT obj, kind,
                regexp_replace(
                  regexp_replace(src, '--[^\n]*', '', 'g'),
                  '/\\*.*?\\*/', '', 'gs') AS s
           FROM defs
       )
       SELECT obj, kind, (s ~ 'is_declared_holding') AS routes
         FROM clean
        WHERE s ~ 'declaration_asset'
          -- Only objects that AGGREGATE a declared value. A function that merely lists
          -- rows (the per-filing asset array) must show чуждо, clearly marked — it is
          -- suppressing it that would lose the finding.
          -- SUM *or* count: „N имота" beside a person's name is as much a claim about
          -- what they own as a euro figure is, and 100/105 read this table for counts
          -- only. A predicate testing SUM alone is blind to exactly those two.
          AND s ~ '(SUM|sum|count)\\s*\\('
          AND obj <> 'is_declared_holding'
        ORDER BY obj`,
    );
    assert.ok(
      rows.length > 4,
      `only ${rows.length} aggregating objects found — migrations applied?`,
    );

    const unrouted = rows
      .filter((r) => !r.routes && !(r.obj in HOLDING_FILTER_EXCEPTIONS))
      .map((r) => `${r.obj} (${r.kind})`);
    assert.deepEqual(
      unrouted,
      [],
      `these sum declared asset values without the holding filter — route them through ` +
        `is_declared_holding() or add them to HOLDING_FILTER_EXCEPTIONS with a reason: ${unrouted.join(", ")}`,
    );

    // An exception for an object that no longer qualifies is stale config that hides the
    // next one.
    const seen = new Set(rows.map((r) => r.obj));
    for (const [obj, why] of Object.entries(HOLDING_FILTER_EXCEPTIONS)) {
      assert.ok(
        seen.has(obj),
        `stale exception '${obj}' (${why}) — object no longer qualifies`,
      );
    }
  },
);
