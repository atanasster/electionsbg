// House-wide gate for the ONE defect that makes a DbDataTable arrival stop being an index
// walk: an index whose NULLS ordering disagrees with what the serving engine emits.
//
// THE RULE. `functions/db_table.js`'s buildOrder spells EVERY descending sort
// `<col> DESC NULLS LAST`. A plain `DESC` btree index is `DESC NULLS FIRST`. Postgres
// compares pathkeys STRUCTURALLY and bridges neither direction, so a mismatched index is
// not a candidate at all — the page degrades to a scan plus a top-N heapsort while every
// row, count and aggregate stays correct. Nothing errors, nothing is logged, and the index
// the migration was written to provide sits there looking right.
//
// ⚠️ THERE IS NO `NOT NULL` ESCAPE HATCH, and believing there is one is how this stayed
// half-fixed. 178's first note blamed the matview ("no NOT NULL constraint for the planner
// to bridge the two with"); there is no bridge to build. Verified on a NOT NULL int column:
// a `(v DESC, id)` index serves `ORDER BY v DESC` and is REFUSED for
// `ORDER BY v DESC NULLS LAST`. `price_products.chain_count` is the corpus proof — NOT NULL,
// an ordinary table, and seq-scanning 102,976 rows on every arrival until 2026-08-20.
//
// ⚠️ THE ORDER BY MUST COME FROM THE ENGINE, NOT FROM THE TEST AUTHOR. The gate that shipped
// with 178 EXPLAINed `ORDER BY money_eur DESC, uic ASC` — a query the engine never issues,
// and one the BROKEN index served perfectly. It certified the defect it existed to catch.
// So the plan arm below captures the real SQL by running `runDbTable` with a q that records
// its statements instead of executing them. Nothing here restates a sort.
//
// TWO ARMS, because neither alone is sufficient:
//   1. CATALOG — deterministic, planner-free, and blind to table size: no relation that can
//      serve a resource's ORDER BY may carry a `DESC NULLS FIRST` index key on a column that
//      resource sorts. This is the arm that catches a NEW migration on day one, before the
//      relation is big enough for the planner to care.
//   2. PLAN — the engine's own arrival SQL must not full-Sort. This is the arm that catches
//      a mismatch the catalog arm cannot express (a tiebreak direction, a partial predicate
//      the filter no longer implies).
// An `Incremental Sort` PASSES the plan arm on purpose: it means the leading key WAS
// index-served and only the tiebreak remains — a different, much cheaper question, and
// sometimes unfixable (ngos sorts on a column of the joined relation).
//
// ⚠️ PUBLISHING A FIX IS A DDL SWAP, NOT A MIGRATION RE-APPLY. Every index below lives in a
// file that DROPs and recreates its matview, so `apply_functions.ts` would rebuild
// person_browse_table / contractor_rank / ngo_signals / procurement_settlement_rank — minutes
// of AccessExclusiveLock on Cloud SQL, and /persons + /procurement/contractors read their
// base relations with no `missingMigration` degrade, so that is a 500 for the duration. The
// index swap itself is seconds and takes only a ShareLock. Run it directly instead; it is
// idempotent, and the next legitimate matview rebuild picks the same shape up from the file:
//
//   DROP INDEX IF EXISTS idx_person_browse_prominence;
//   CREATE INDEX idx_person_browse_prominence   ON person_browse_table (prominence DESC NULLS LAST, name, key);
//   DROP INDEX IF EXISTS idx_person_browse_tier_default;
//   CREATE INDEX idx_person_browse_tier_default ON person_browse_table (tier, prominence DESC NULLS LAST, name, key);
//   DROP INDEX IF EXISTS idx_person_browse_exec;
//   CREATE INDEX idx_person_browse_exec    ON person_browse_table (prominence DESC NULLS LAST, name, key) WHERE is_exec;
//   DROP INDEX IF EXISTS idx_person_browse_muni;
//   CREATE INDEX idx_person_browse_muni    ON person_browse_table (prominence DESC NULLS LAST, name, key) WHERE is_muni;
//   DROP INDEX IF EXISTS idx_person_browse_decl;
//   CREATE INDEX idx_person_browse_decl    ON person_browse_table (prominence DESC NULLS LAST, name, key) WHERE has_declaration;
//   DROP INDEX IF EXISTS idx_person_browse_company;
//   CREATE INDEX idx_person_browse_company ON person_browse_table (prominence DESC NULLS LAST, name, key) WHERE is_company;
//   DROP INDEX IF EXISTS idx_person_browse_held;
//   CREATE INDEX idx_person_browse_held    ON person_browse_table (prominence DESC NULLS LAST, name, key) WHERE held_office;
//   DROP INDEX IF EXISTS idx_contractor_rank_total;
//   CREATE INDEX idx_contractor_rank_total     ON contractor_rank (scope_key, division, total_eur DESC NULLS LAST, eik);
//   DROP INDEX IF EXISTS idx_contractor_rank_contracts;
//   CREATE INDEX idx_contractor_rank_contracts ON contractor_rank (scope_key, division, contract_count DESC NULLS LAST, eik);
//   DROP INDEX IF EXISTS idx_psr_scope_total;
//   CREATE INDEX idx_psr_scope_total     ON procurement_settlement_rank (scope_key, total_eur DESC NULLS LAST, ekatte);
//   DROP INDEX IF EXISTS idx_psr_scope_contracts;
//   CREATE INDEX idx_psr_scope_contracts ON procurement_settlement_rank (scope_key, contract_count DESC NULLS LAST, ekatte);
//   DROP INDEX IF EXISTS idx_ngo_signals_money;
//   CREATE INDEX idx_ngo_signals_money ON ngo_signals (public_money_eur DESC NULLS LAST, eik);
//   DROP INDEX IF EXISTS idx_ngo_signals_count;
//   CREATE INDEX idx_ngo_signals_count ON ngo_signals (signal_count DESC NULLS LAST, eik);
//   DROP INDEX IF EXISTS idx_person_crypto_scope_value;
//   CREATE INDEX idx_person_crypto_scope_value ON person_crypto_table (scope, value_eur DESC NULLS LAST);
//   DROP INDEX IF EXISTS price_products_browse;
//   CREATE INDEX price_products_browse ON price_products (chain_count DESC NULLS LAST, product_id) WHERE chain_count > 0;
//   DROP INDEX IF EXISTS idx_tenders_buyer_date;
//   CREATE INDEX idx_tenders_buyer_date ON tenders (buyer_eik, publication_date DESC NULLS LAST, unp)
//     INCLUDE (estimated_value_eur, procedure_type, is_eu_funded);
//
// then VACUUM (ANALYZE, PARALLEL 0) the seven relations — a fresh index has no visibility
// map behind it, and `reload_visibility_map.data.test.ts` documents why a bare ANALYZE is
// the disguise rather than half the fix.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, withTx, dbReachable, end } from "../lib/pg";
import { createRequire } from "node:module";
import path from "node:path";

// The SERVING registry and the SERVING order builder, read rather than restated.
// `functions/` is a separate CJS package, so a plain import will not do.
const req = createRequire(import.meta.url);
const { REGISTRY, runDbTable } = req(
  path.resolve(import.meta.dirname, "../../../functions/db_table.js"),
) as {
  REGISTRY: Record<string, Resource>;
  runDbTable: (q: Q, req: Record<string, unknown>) => Promise<unknown>;
};

/** Thrown to force withTx to ROLL BACK after a probe that must not persist. */
/** Thrown to force withTx to ROLL BACK after a probe whose DDL must not persist. */
class Rollback extends Error {}

type Q = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
interface Resource {
  base: string;
  aggBase?: string;
  columns: Record<string, { sort?: boolean } | undefined>;
  select: string[];
  defaultSort: ([string, string] | { id: string; desc?: boolean })[];
}

const sortId = (s: [string, string] | { id: string; desc?: boolean }) =>
  Array.isArray(s) ? s[0] : s.id;

/**
 * The request a REAL arrival carries. Empty = the bare `/api/db/table` default, which is
 * what most screens send. A non-empty entry MIRRORS a screen and names it: the engine
 * applies `defaultScope`/`defaultFilters` itself, but a `fixedFilters` prop is knowledge
 * only the screen has, and testing the bare shape instead would EXEMPT the very path the
 * index exists for (price_products' index is partial on `chain_count > 0`, so it can only
 * be a candidate for an arrival that carries the browser's own `chain_count >= 1`).
 */
const ARRIVALS: Record<string, Record<string, unknown>> = {
  // src/screens/dev/ContractsBrowserDbScreen.tsx — fixedFilters={[{id:"tag",value:["contract"]}]}
  contracts: { filters: { columns: [{ id: "tag", value: ["contract"] }] } },
  // src/screens/consumption/ProductsBrowserScreen.tsx — fixedFilters={[{id:"chain_count",min:1}]}
  price_products: { filters: { columns: [{ id: "chain_count", min: 1 }] } },
  // src/screens/dev/NgoBrowseDbScreen.tsx — fixedFilters + the default has_signal toggle
  ngos: {
    filters: {
      columns: [
        {
          id: "entity_class",
          value: ["ngo_assoc", "ngo_found", "chitalishte"],
        },
        { id: "has_signal", value: true },
      ],
    },
  },
  // Scoped browsers: the screen passes scope={{col,val}}; the engine's defaultScope covers
  // the same column, but pass it explicitly so the shape matches the screen exactly.
  contractor_rankings: { scope: { col: "scope_key", val: "all" } },
  procurement_settlements: { scope: { col: "scope_key", val: "all" } },
  crypto_holdings: { scope: { col: "scope", val: "latest" } },
  abroad_holdings: { scope: { col: "scope", val: "latest" } },
};

/**
 * Index keys that keep the NULLS FIRST spelling ON PURPOSE, `"<relation>.<index>.<column>"`.
 *
 * An entry means a SECOND consumer of the same index sorts the column with a plain `DESC`
 * and would lose more than the browser gains. That is a real conflict, not a loophole: the
 * two orderings cannot share one btree, so one of them sorts. Each entry must carry the A/B
 * that decided it, and the losing side's cost.
 */
const CATALOG_EXCEPTIONS: Record<string, string> = {
  "tenders.idx_tenders_buyer_date.publication_date":
    "tenders_by_buyer (010) sorts `publication_date DESC, unp DESC` and is the AWARDER PAGE's " +
    "DEFAULT load; the browser's date sort is an opt-in column click. A/B on one database: " +
    "this spelling is 254 buffers for tenders_by_buyer and the buildOrder-matching spelling is " +
    "2,603 (the planner drops the buyer seek and scans idx_tenders_order backward over the " +
    "corpus). The browser pays 4,356 instead of 2,103 — an order of magnitude cheaper to lose. " +
    "Same conflict and same resolution as 042's idx_kzk_appeals_date.",
};

/**
 * Resources whose arrival legitimately does NOT ride an ordered index, each with the reason
 * and the measurement that settles it. An entry here is a DECISION, not a suppression — a
 * stale one fails below, so removing the reason is not free.
 */
const PLAN_EXCEPTIONS: Record<string, string> = {
  company_person_roles:
    "1.28M rows and no index on `share`. Its ONLY caller (src/screens/dev/CompanyOfficersDbScreen.tsx) " +
    "always sends uic, and THAT path is 4 buffers / 0.02 ms via idx_company_person_roles_uic. " +
    "The unfiltered arrival is 26,496 buffers / 2.0 s but is not a page; a `(share DESC NULLS LAST, key)` " +
    "index costs 92 MB against a 207 MB heap to serve nothing a reader reaches.",
  magistrate_holdings:
    "magistrate_holdings_table is a plain VIEW over 110 rows — it has no indexes and can have none. " +
    "247 buffers / 0.5 ms.",
  crypto_holdings:
    "person_crypto_table is 114 rows / 8 pages, so the planner correctly seq-scans it whatever the " +
    "index says (measured 8 buffers before and after the NULLS LAST fix). 159's index is spelled " +
    "correctly anyway — the catalog arm still enforces that, which is the point of having two arms.",
};

const skip = (await dbReachable()) ? false : "Postgres unreachable";

afterAll(async () => {
  await end();
});

/** The SQL the engine issues for `res`'s arrival — captured, never composed. */
const arrivalSql = async (
  name: string,
): Promise<{ sql: string; params: unknown[] }> => {
  const captured: { sql: string; params: unknown[] }[] = [];
  const q: Q = async (sql, params) => {
    captured.push({ sql, params });
    if (/_count/.test(sql)) return [{ _count: "0" }];
    if (/reltuples/.test(sql)) return [{ est: "0" }];
    return [];
  };
  await runDbTable(q, { resource: name, ...(ARRIVALS[name] ?? {}) });
  // The page query is the FIRST statement runDbTable issues; the aggregate follows.
  return captured[0];
};

const planOf = async (
  sql: string,
  params: unknown[],
  c?: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> },
): Promise<string> => {
  const rows = c
    ? ((await c.query(`EXPLAIN ${sql}`, params)).rows as Record<
        string,
        string
      >[])
    : await allRows<Record<string, string>>(`EXPLAIN ${sql}`, params);
  return rows.map((r) => r["QUERY PLAN"]).join("\n");
};

/**
 * A FULL `Sort` node means the index was refused outright and the whole filtered set was
 * materialised and heapsorted. `Incremental Sort` is deliberately NOT a failure: it means
 * the leading sort key WAS index-served and only the tiebreak remains — cheap, and for a
 * sort whose tiebreak lives on a joined relation (ngos) not fixable from one index at all.
 * Matched per LINE with the tree prefix stripped, so "Incremental Sort" cannot be read as
 * "Sort" and a root-level Sort (no `->` arrow) is not missed.
 */
const fullSort = (plan: string) =>
  plan
    .split("\n")
    .map((l) => l.replace(/^\s*(->\s+)?/, ""))
    // `^Sort\b` is WRONG here and passed review once: every Sort node is followed by a
    // `Sort Key: …` DETAIL line, which that pattern matches — so an Incremental Sort plan
    // reported a full sort and three healthy resources failed. Require the node form,
    // `Sort  (cost=…)`, which no detail line has.
    .some((l) => /^Sort\s+\(/.test(l));

// ── ARM 1: the catalog ────────────────────────────────────────────────────────────────
//
// Planner-free and size-independent, so it fires on a brand-new migration whose relation is
// still small enough that the plan arm would pass.

/**
 * int2vector subscripts are 0-BASED, and `indoption` is parallel to `indkey`. Spelling this
 * with `generate_subscripts(...)` and a `- 1` (the obvious-looking form) silently drops the
 * FIRST key of every index — which exempts every single-column index outright. That bug was
 * live in this audit's first draft and hid `idx_ngo_signals_money`, the largest finding.
 * `indnkeyatts` bounds it to KEY columns, so an INCLUDE payload is correctly ignored.
 *   indoption bit 0 = DESC, bit 1 = NULLS FIRST → `DESC NULLS LAST` is 1, `DESC NULLS FIRST` is 3.
 */
const DESC_NULLS_FIRST_KEYS = `
SELECT c.relname AS rel, i.relname AS idx, a.attname AS col, k.ord AS keypos
  FROM pg_index x
  JOIN pg_class i ON i.oid = x.indexrelid
  JOIN pg_class c ON c.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL generate_series(0, x.indnkeyatts - 1) AS k(ord)
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = x.indkey[k.ord]
 WHERE n.nspname = 'public'
   AND i.relam = (SELECT oid FROM pg_am WHERE amname = 'btree')
   AND (x.indoption[k.ord] & 1) = 1
   AND (x.indoption[k.ord] & 2) = 2`;

/**
 * Relations that could serve a resource's ORDER BY. A table or MATVIEW carries its own
 * indexes, so it is the whole answer. A plain VIEW carries none — its sort has to be served
 * by an index on a source relation, so those are resolved through pg_rewrite. Expanding
 * matviews too would false-positive on any source that merely shares a column NAME
 * (official_companies reads tr_company_place, which has its own unrelated `money_eur`).
 */
const VIEW_SOURCES = `
SELECT DISTINCT d.refobjid::regclass::text AS rel
  FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
 WHERE r.ev_class = $1::regclass AND d.refclassid = 'pg_class'::regclass
   AND d.deptype = 'n' AND d.refobjid <> r.ev_class`;

test.skipIf(skip)(
  "no index that can serve a browser sort is DESC NULLS FIRST on a sorted column",
  async () => {
    const bad = await allRows<{
      rel: string;
      idx: string;
      col: string;
      keypos: number;
    }>(DESC_NULLS_FIRST_KEYS);
    const byRel = new Map<string, typeof bad>();
    for (const b of bad) {
      if (!byRel.has(b.rel)) byRel.set(b.rel, []);
      byRel.get(b.rel)!.push(b);
    }

    const failures: string[] = [];
    const usedExceptions = new Set<string>();
    // Returns true when this (relation, index, column) is a recorded exception — and records
    // that it was reached, so a stale entry can be failed below.
    const seen = {
      add(key: string): boolean {
        if (!(key in CATALOG_EXCEPTIONS)) return false;
        usedExceptions.add(key);
        return true;
      },
    };
    let examined = 0;
    for (const [name, r] of Object.entries(REGISTRY)) {
      // A reader may click ANY sortable column descending, so the rule covers all of them,
      // not only defaultSort — the default is merely the one that is always paid.
      const sortable = new Set(
        Object.entries(r.columns ?? {})
          .filter(([, d]) => d?.sort)
          .map(([id]) => id),
      );
      for (const s of r.defaultSort ?? []) sortable.add(sortId(s));
      if (!sortable.size) continue;

      const rels = new Set<string>([r.base]);
      if (r.aggBase) rels.add(r.aggBase);
      const [k] = await allRows<{ relkind: string }>(
        "SELECT relkind FROM pg_class WHERE oid = $1::regclass",
        [r.base],
      );
      if (k?.relkind === "v")
        for (const s of await allRows<{ rel: string }>(VIEW_SOURCES, [r.base]))
          rels.add(s.rel);

      for (const rel of rels) {
        examined += sortable.size;
        for (const b of byRel.get(rel) ?? [])
          if (sortable.has(b.col) && !seen.add(`${rel}.${b.idx}.${b.col}`))
            failures.push(
              `${name}: ${rel}.${b.idx} key ${b.keypos} is "${b.col} DESC NULLS FIRST", ` +
                `but buildOrder emits "${b.col} DESC NULLS LAST" — the index cannot serve it`,
            );
      }
    }
    assert.deepEqual(
      failures,
      [],
      `index NULLS ordering disagrees with the serving engine:\n  ${failures.join("\n  ")}`,
    );
    assert.ok(
      examined > 0,
      "no resource resolved to a relation carrying any DESC NULLS FIRST key — the join is " +
        "not reaching the catalog",
    );
    // A stale exception is as much a defect as a missing one: it asserts a conflict that no
    // longer exists and quietly exempts a column the next migration may break.
    const stale = Object.keys(CATALOG_EXCEPTIONS).filter(
      (k) => !usedExceptions.has(k),
    );
    assert.deepEqual(
      stale,
      [],
      `CATALOG_EXCEPTIONS entries no longer match anything — the index was re-spelled or ` +
        `renamed, so delete the entry rather than leaving a stale reason on the record: ` +
        `${stale.join(", ")}`,
    );
  },
);

test.skipIf(skip)(
  "MUTATION CHECK: the catalog scan actually sees a DESC NULLS FIRST key",
  async () => {
    // The scan's whole risk is going silently blind. int2vector subscripts are 0-based, and
    // the natural-looking `generate_subscripts(x.indkey::int2[], 1) ... [k.ord - 1]` drops
    // the first key column of every index — so every SINGLE-COLUMN index is exempted and the
    // gate reports a clean corpus. That bug was live in this audit's first pass and hid
    // idx_ngo_signals_money, which was costing /ngos 17,630 buffers an arrival.
    //
    // Asserting "the corpus contains at least one such index" would NOT catch it: plenty
    // exist for hand-written SQL that spells its ORDER BY the same way, so the count stays
    // comfortably non-zero while the scan is half-blind. Plant one instead, with a shape
    // that only the correct subscripts can see, and require the scan to find it.
    await withTx(async (c) => {
      await c.query(
        "CREATE INDEX tmp_nulls_first_probe ON person_browse_table (prominence DESC)",
      );
      const { rows } = await c.query(
        `SELECT count(*)::text AS n FROM (${DESC_NULLS_FIRST_KEYS}) z
          WHERE z.idx = 'tmp_nulls_first_probe' AND z.col = 'prominence' AND z.keypos = 0`,
      );
      assert.equal(
        (rows[0] as { n: string }).n,
        "1",
        "the catalog scan did not see a planted single-column DESC NULLS FIRST index — it is " +
          "blind to the first key of every index (check the 0-based indkey/indoption subscripts)",
      );
      throw new Rollback();
    }).catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
  },
);

// ── ARM 2: the plan ───────────────────────────────────────────────────────────────────

for (const name of Object.keys(REGISTRY)) {
  const desc = (REGISTRY[name].defaultSort ?? []).some(
    (s) =>
      (Array.isArray(s) ? s[1] : s.desc) === "desc" ||
      (Array.isArray(s) ? s[1] : s.desc) === true,
  );
  if (!desc) continue;
  test.skipIf(skip)(
    `${name}: the engine's own default arrival does not full-sort`,
    async () => {
      const { sql, params } = await arrivalSql(name);
      assert.match(
        sql,
        /DESC NULLS LAST/,
        "buildOrder no longer emits DESC NULLS LAST — this whole gate is calibrated to that " +
          "spelling and every index in the repo is built for it",
      );
      const plan = await planOf(sql, params);
      const why = PLAN_EXCEPTIONS[name];
      if (why) {
        assert.ok(
          fullSort(plan),
          `${name} is listed in PLAN_EXCEPTIONS but its arrival is now index-served — delete ` +
            `the entry rather than leaving a stale reason on the record.\nreason was: ${why}`,
        );
        return;
      }
      assert.ok(
        !fullSort(plan),
        `${name}'s arrival full-sorts, so no index served it:\n${sql}\n\n${plan}`,
      );
    },
  );
}

test.skipIf(skip)(
  "MUTATION CHECK: restoring a NULLS FIRST index turns the plan arm red",
  async () => {
    // Without this the plan arm is satisfiable by any implementation that happens not to
    // sort — including one where the assertion has quietly stopped discriminating.
    //
    // ⚠️ RUN AGAINST contractor_rankings, NOT persons. `persons` is the largest measured win
    // (6,978 buffers → 28) and is the WRONG subject here: person_browse_table carries TWO
    // prominence-leading indexes, so re-breaking idx_person_browse_tier_default just moves
    // the planner onto idx_person_browse_prominence with a `Filter: tier = 'P'` — still an
    // Index Scan, still no Sort, and the mutation proves nothing. contractor_rank has a
    // single ordered candidate for its arrival, so breaking it is observable.
    const { sql, params } = await arrivalSql("contractor_rankings");
    const before = await planOf(sql, params);
    assert.ok(
      !fullSort(before),
      "contractor_rankings already full-sorts — apply 122 " +
        "(npm run db:load:procurement-scopes:pg) before reading this as a mutation-check problem",
    );
    await withTx(async (c) => {
      await c.query("DROP INDEX idx_contractor_rank_total");
      await c.query(
        "CREATE INDEX idx_contractor_rank_total " +
          "ON contractor_rank (scope_key, division, total_eur DESC, eik)",
      );
      const after = await planOf(sql, params, c);
      assert.ok(
        fullSort(after),
        "a DESC NULLS FIRST index STILL served the arrival — either Postgres learned to " +
          "bridge the two NULLS orderings (in which case this entire gate is obsolete) or " +
          `fullSort() has stopped recognising a Sort node:\n${after}`,
      );
      // Roll back: this index is real and the transaction must not keep the broken one.
      throw new Rollback();
    }).catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
  },
);
