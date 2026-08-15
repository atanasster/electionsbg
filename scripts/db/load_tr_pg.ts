// Load the Commerce-Registry (TR) companies + officers into Postgres for name
// search. Reads raw_data/tr/state.sqlite (the existing TR store), folds names via
// translit_bg_latin (a generated column), and builds GIN trigram indexes after
// the bulk load. Officers are deduped to one row per (uic, name).
//
//   npm run db:load:tr:pg        (needs `npm run db:pg:up` first)
//
// See docs/plans/postgres-migration-v1.md (Feature 1).

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { PoolClient } from "pg";
import {
  end,
  exec,
  getPool,
  refreshMatviewConcurrently,
  vacuumAfterReload,
  withClient,
  withTx,
} from "./lib/pg";
import { copyRows } from "./lib/copy";
import { recordIngestBatch } from "./lib/ingest_changelog";
import { rebuildRiskGradeScoped } from "./lib/riskGradeScoped";
import { refreshScopedPrecomputes } from "./lib/scopedMatviews";

const TR_DB = fileURLToPath(
  new URL("../../raw_data/tr/state.sqlite", import.meta.url),
);
const FN_SQL = fileURLToPath(
  new URL("./schema/pg/000_search_fns.sql", import.meta.url),
);
const TR_SQL = fileURLToPath(
  new URL("./schema/pg/003_tr_search.sql", import.meta.url),
);
const INGEST_SQL = fileURLToPath(
  new URL("./schema/pg/005_ingest_tracking.sql", import.meta.url),
);
const API_SQL = fileURLToPath(
  new URL("./schema/pg/004_search_api.sql", import.meta.url),
);
const BUILDERS_SQL = fileURLToPath(
  new URL("./schema/pg/007_query_builders.sql", import.meta.url),
);
const CONN_SQL = fileURLToPath(
  new URL("./schema/pg/008_connections.sql", import.meta.url),
);
const RELATED_SQL = fileURLToPath(
  new URL("./schema/pg/019_related_companies.sql", import.meta.url),
);
const OFFICERS_SQL = fileURLToPath(
  new URL("./schema/pg/022_company_officers.sql", import.meta.url),
);
const PERSON_API_SQL = fileURLToPath(
  new URL("./schema/pg/024_person_api.sql", import.meta.url),
);
// The two portfolio-breakdown cuts that extend person_procurement (024). Applied right after
// it — same deps (tr_officers / tr_companies / contracts, all loaded here). The _slug variants
// reference person_role (created later by resolve_persons), but the file SETs
// check_function_bodies = off, so create-time succeeds and they resolve at call time.
const PERSON_BREAKDOWNS_SQL = fileURLToPath(
  new URL("./schema/pg/125_person_procurement_breakdowns.sql", import.meta.url),
);
const MP_JSON = fileURLToPath(
  new URL("../../data/procurement/derived/mp_connected.json", import.meta.url),
);
const PEP_JSON = fileURLToPath(
  new URL("../../data/procurement/derived/pep_connected.json", import.meta.url),
);

const gitSha = (): string => {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

const waitForPg = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) {
    try {
      await getPool().query("SELECT 1");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("Postgres not reachable — run `npm run db:pg:up`.");
};

// Streamed COPY … FROM STDIN. Was a batched multi-row INSERT (chunked to stay
// under PG's 65535-param cap), which meant ~290 round trips of bound parameters
// for tr_companies' 1,017,624 rows. Over the Cloud SQL proxy that dominated
// `db:load:tr:pg:cloud`. copyRows streams one framed text payload instead; the
// encoder is round-trip-verified in tests/copy.data.test.ts.
//
// `rows` is an Iterable so the caller can pass a lazy generator and avoid holding
// a second copy of the corpus beside the SQLite result set.
//
// `after` runs inside the SAME transaction, once the COPY has landed — the table
// is already fully populated for that txn, so a caller can derive from it (the
// changelog write below) and have the derivation commit atomically with the data.
const copyTable = async <T = void>(
  table: string,
  cols: string[],
  rows: Iterable<unknown[]>,
  after?: (c: PoolClient) => Promise<T>,
): Promise<T | undefined> =>
  withTx(async (c) => {
    await copyRows(c, table, cols, rows);
    return after ? await after(c) : undefined;
  });

// The four tables this loader owns outright — every run replaces their whole
// contents. TRUNCATE runs INSIDE the COPY's transaction (see replaceTable), so a
// reader keeps seeing the previous vintage until that one commit, and a failed
// load leaves the old rows rather than an empty table.
//
// This is what 003 used to get by dropping the tables, and it is why it no longer
// may: the DROP took three matviews owned by other migrations with it (003's
// header has the full account).
//
// THE LOCK PROFILE IS A REGRESSION, and deliberately so — do not "restore" the old
// one. Measured 2026-08-10 (docs/plans/cloud-deploy-speed-v1.md F21): 50 of 180
// concurrent probes across a live load are now REJECTED with 55P03, because
// TRUNCATE takes an AccessExclusiveLock held until the COPY commits.
//
// The old scheme did NOT block readers, contrary to how it looks. exec() sends 003
// as one string and the simple query protocol wraps that in a SINGLE implicit
// transaction, so the DROP and the CREATE committed atomically and no reader could
// see the table absent; the COPYs then ran in their own later transactions holding
// only RowExclusiveLock, which does not conflict with AccessShare. What readers got
// instead was an EMPTY, then progressively filling, table — a 200 with zero rows for
// the length of the load, i.e. search confidently answering "no such company".
//
// An error a route can degrade on (55P03 is already in the documented degrade set)
// beats a silently-empty answer, so this is the right way round. Removing the choice
// needs a stage merge (lib/stage_merge.ts) — but only tr_companies and ngo_details
// have a unique key to merge on, tr_officers would need one declared, and
// tr_person_roles has none available. Scoped as Phase 4b in that plan.
//
// THE TRUNCATE STATEMENTS ARE LITERALS, and that is a requirement rather than a
// style choice. `person_reload_locks.data.test.ts` reads the serving surface out
// of the SQL and forbids TRUNCATE on any table a person route serves —
// tr_companies is one (082_person_api.sql JOINs it). Its scanner matches
// `TRUNCATE\s+(?:TABLE\s+)?([a-z_0-9,\s]+)`, so a `TRUNCATE ${table}` names no
// table it can see and the whole debt was invisible to the gate that exists to
// track it. Spelling the four out keeps them visible, and makes an injected
// identifier impossible as a side effect. That gate now REFUSES an interpolated
// TRUNCATE outright, so this cannot regress quietly.
const TRUNCATE_SQL: Record<string, string> = {
  tr_companies: "TRUNCATE tr_companies",
  ngo_details: "TRUNCATE ngo_details",
  tr_officers: "TRUNCATE tr_officers",
  tr_person_roles: "TRUNCATE tr_person_roles",
};

const replaceTable = async <T = void>(
  table: string,
  cols: string[],
  rows: Iterable<unknown[]>,
  after?: (c: PoolClient) => Promise<T>,
): Promise<T | undefined> => {
  const truncate = TRUNCATE_SQL[table];
  if (!truncate)
    throw new Error(
      `replaceTable: ${table} has no entry in TRUNCATE_SQL. Add one — ` +
        `person_reload_locks.data.test.ts cannot see an interpolated identifier.`,
    );
  return withTx(async (c) => {
    // Index drops belong INSIDE this transaction. Through exec() they are
    // autocommitted, so any failure between them and the rebuild at the end of the
    // load — a killed process, a dropped Cloud SQL proxy connection — commits the
    // drops and never reaches the creates, leaving the table POPULATED BUT
    // UNINDEXED. That state is complete and correct to every row count in this
    // repo, and turns every person query joining tr_officers.name_fold into a
    // multi-minute seq scan. Observed for real 2026-08-10
    // (docs/plans/cloud-deploy-speed-v1.md F21). In here, an aborted load rolls the
    // drops back along with the TRUNCATE.
    for (const { name, table: t } of LOAD_INDEXES)
      if (t === table) await c.query(`DROP INDEX IF EXISTS ${name}`);
    await c.query(truncate);
    await copyRows(c, table, cols, rows);
    return after ? await after(c) : undefined;
  });
};

// Secondary indexes built ONCE after the bulk load — a one-shot GIN build is far
// cheaper than maintaining the index across ~3M COPYed rows. They used to vanish
// with 003's `DROP TABLE`; now that the tables persist, the loader drops them
// itself so the same one-shot build applies on every run (and so the
// unconditional CREATEs below stay re-runnable instead of raising 42P07).
//
// The PRIMARY KEYs on tr_companies / ngo_details are deliberately NOT in here:
// they are part of the table definition, and they were maintained during the COPY
// under the old DROP+CREATE too, so leaving them is exactly the previous
// behaviour.
//
// Name and table are PARSED from each statement rather than restated beside it.
// Written twice, a typo makes the DROP target a name that does not exist and the
// CREATE then raise 42P07 on the second run; parsed once, the two cannot disagree.
// replaceTable also needs the table to drop the right subset inside each
// transaction, which restating would be a third copy of the same fact.
export const LOAD_INDEXES: { name: string; table: string; ddl: string }[] = [
  "CREATE INDEX idx_tr_companies_fold ON tr_companies USING gin (name_fold gin_trgm_ops)",
  "CREATE INDEX idx_tr_officers_fold ON tr_officers USING gin (name_fold gin_trgm_ops)",
  "CREATE INDEX idx_tr_officers_uic ON tr_officers (uic)",
  // Entity-class facet (NGO browse/segmentation) + NGO metadata lookup. The
  // composite (entity_class, name) also serves the /procurement/ngos browse's
  // default name-sort — a single-category facet becomes an index-only scan
  // (~0.2ms vs a ~190ms top-N sort over 30k rows).
  "CREATE INDEX idx_tr_companies_entity_class ON tr_companies (entity_class)",
  "CREATE INDEX idx_tr_companies_class_name ON tr_companies (entity_class, name)",
  // Partial trigram index over the NGO surface only — serves the fuzzy name
  // match in load_ngo_funding_pg.ts. Scoped so the `%` operator prunes to the
  // ~31k NGO rows via the index instead of an O(staged × NGO) similarity() seq
  // scan (which took ~1hr on Cloud SQL's shared core).
  `CREATE INDEX idx_tr_companies_ngo_fold ON tr_companies USING gin (name_fold gin_trgm_ops)
   WHERE entity_class IN ('ngo_assoc','ngo_found','chitalishte','foreign_branch')`,
  // Btree for exact-fold person lookup (person_profile / connection_between).
  "CREATE INDEX idx_tr_officers_fold_eq ON tr_officers (name_fold)",
  "CREATE INDEX idx_tr_person_roles_fold ON tr_person_roles (name_fold)",
  "CREATE INDEX idx_tr_person_roles_uic ON tr_person_roles (uic)",
  // Timestamp indexes for recent_updates' day-window filter.
  "CREATE INDEX idx_tr_companies_updated ON tr_companies (last_updated)",
  "CREATE INDEX idx_tr_officers_changed ON tr_officers (changed_at)",
].map((ddl) => {
  const m = /CREATE INDEX (\w+) ON (\w+)/.exec(ddl);
  if (!m) throw new Error(`LOAD_INDEXES entry is unparseable: ${ddl}`);
  return { name: m[1] as string, table: m[2] as string, ddl };
});

export const loadTrPg = async (): Promise<{
  companies: number;
  officers: number;
  /** Companies first seen in this load (the changelog delta). */
  companiesNew: number;
}> => {
  await waitForPg();
  await exec(readFileSync(FN_SQL, "utf8"));
  await exec(readFileSync(TR_SQL, "utf8"));
  // ingest_batches / ingest_first_seen / changelog_days — the TR load records its
  // batch below, and 007 (applied later here) reads them. Idempotent, and safe on
  // a contracts-less DB (005 defers its function-body validation).
  await exec(readFileSync(INGEST_SQL, "utf8"));

  const tr = new DatabaseSync(TR_DB, { readOnly: true });

  // NOTE: the secondary indexes are dropped per table INSIDE replaceTable's
  // transaction, not in a loop here. An autocommitted drop up front survives an
  // aborted load and leaves the table populated but unindexed — see replaceTable.

  const companies = tr
    .prepare(
      "SELECT uic, name, legal_form, seat, status, funds_amount, funds_currency, last_updated, objectives, means, public_benefit, private_benefit FROM companies WHERE name IS NOT NULL AND name <> ''",
    )
    .all() as Array<Record<string, string | number | null>>;
  // One changelog row per refresh, covering the whole TR load (companies +
  // officers + person-roles + ngo_details are one dataset from one source, and
  // the company corpus is its headline entity — its EIK is the stable key that
  // survives this loader's DROP+reload, and officers/roles hang off it).
  //
  // threshold 0 → this source ALWAYS summarises ("N new · M total"), never
  // itemises. Deliberate, and not just about volume: recent_updates already
  // itemises TR per-row from the registry's OWN timestamps (the company/officer
  // branches, keyed on last_updated/changed_at). A per-row ingest branch here
  // would report every new company a SECOND time under a different kind and at a
  // different timestamp (ingest time, ~2 days after the registry date this feed
  // lags by). The cold load is ~1M new keys, but a daily delta is only a few
  // hundred — under INGEST_SUMMARY_THRESHOLD — so leaving the default would put
  // the loader into detail mode every day and duplicate the feed.
  const ingest = await replaceTable(
    "tr_companies",
    [
      "uic",
      "name",
      "legal_form",
      "seat",
      "status",
      "funds_amount",
      "funds_currency",
      "last_updated",
    ],
    (function* () {
      for (const r of companies)
        yield [
          r.uic,
          r.name,
          r.legal_form,
          r.seat,
          r.status,
          r.funds_amount,
          r.funds_currency,
          r.last_updated || null, // '' → NULL for the timestamptz column
        ];
    })(),
    // In-txn: the changelog commits with the companies it describes.
    (c) =>
      recordIngestBatch(c, {
        source: "tr_company",
        table: "tr_companies",
        keyExpr: "t.uic", // EIK — stable, survives the DROP+reload.
        rowsTotal: companies.length,
        threshold: 0,
      }),
  );

  // ЮЛНЦ metadata sidecar — only rows that actually carry NGO fields.
  const ngoDetails = companies.filter(
    (r) =>
      r.objectives != null ||
      r.means != null ||
      r.public_benefit != null ||
      r.private_benefit != null,
  );
  // Unconditional, even when the filter yields nothing: the TRUNCATE lives inside
  // replaceTable, so guarding the call on `ngoDetails.length` would leave the
  // previous run's rows in place on a source that has stopped carrying NGO fields.
  // A zero-row COPY is a valid no-op (lib/copy.ts).
  await replaceTable(
    "ngo_details",
    ["uic", "public_benefit", "private_benefit", "objectives", "means"],
    (function* () {
      for (const r of ngoDetails)
        yield [
          r.uic,
          r.public_benefit == null ? null : r.public_benefit === 1,
          r.private_benefit == null ? null : r.private_benefit === 1,
          r.objectives,
          r.means,
        ];
    })(),
  );

  const officers = tr
    .prepare(
      `SELECT uic, name,
              group_concat(DISTINCT role) AS roles,
              MAX(CASE WHEN erased_at IS NULL THEN 1 ELSE 0 END) AS active,
              MAX(COALESCE(NULLIF(erased_at, ''), NULLIF(added_at, ''))) AS changed_at
       FROM company_persons
       WHERE name IS NOT NULL AND name <> ''
       GROUP BY uic, name`,
    )
    .all() as Array<Record<string, string | number | null>>;
  await replaceTable(
    "tr_officers",
    ["uic", "name", "roles", "active", "changed_at"],
    (function* () {
      for (const r of officers)
        yield [r.uic, r.name, r.roles, r.active, r.changed_at || null];
    })(),
  );

  // Raw per-role records for the person page's history (from/to dates + share).
  const roles = tr
    .prepare(
      `SELECT uic, name, role, country, share_percent, share_amount, share_currency, added_at, erased_at, position_label
       FROM company_persons
       WHERE name IS NOT NULL AND name <> ''`,
    )
    .all() as Array<Record<string, string | number | null>>;
  await replaceTable(
    "tr_person_roles",
    [
      "uic",
      "name",
      "role",
      "country",
      "share",
      "share_amount",
      "share_currency",
      "added_at",
      "erased_at",
      "position_label",
    ],
    (function* () {
      for (const r of roles)
        yield [
          r.uic,
          r.name,
          r.role,
          r.country,
          r.share_percent,
          r.share_amount,
          r.share_currency,
          r.added_at || null,
          r.erased_at || null,
          r.position_label || null,
        ];
    })(),
  );
  tr.close();

  // One-shot index build (cheaper than incremental during load). Dropped above,
  // so these stay unconditional CREATEs — see LOAD_INDEXES for what each is for.
  for (const { ddl } of LOAD_INDEXES) await exec(ddl);
  // ANALYZE every table replaced above, not just the two the loader used to name.
  // TRUNCATE does NOT reset pg_statistic, so where the old DROP+CREATE left stats
  // genuinely absent — which the planner treats as unknown — this leaves the
  // PREVIOUS vintage's stats in place, which it trusts. tr_person_roles is the
  // largest of the four and feeds company_person_roles and owner_name_counts on
  // this same path.
  for (const t of Object.keys(TRUNCATE_SQL)) await exec(`ANALYZE ${t}`);

  // Search API + multi-table builders (idempotent; depend on the tables +
  // contracts + contract_first_seen + contractor_search).
  await exec(readFileSync(API_SQL, "utf8"));
  await exec(readFileSync(BUILDERS_SQL, "utf8"));
  await exec(readFileSync(CONN_SQL, "utf8"));

  // Related-companies (same-owner) namesake index + fn. Matview is refreshed so
  // re-runs don't leave the owner→company counts stale.
  await exec(readFileSync(RELATED_SQL, "utf8"));
  await exec("REFRESH MATERIALIZED VIEW owner_name_counts");

  // Deduped officers relation for the server-side officers table.
  await exec(readFileSync(OFFICERS_SQL, "utf8"));
  await exec("REFRESH MATERIALIZED VIEW company_person_roles");
  // Officer namesake counts (hub pruning for the multi-hop path finder).
  await exec("REFRESH MATERIALIZED VIEW officer_name_counts");

  // Its DUAL — companies by officer count (071), the hub filter the magistrate
  // bridge walk refuses to hop through. Pure derivation of the tr_officers this
  // loader just replaced, so a TR ingest invalidates it exactly as it does
  // officer_name_counts above. 071's own comment delegates the refresh to the
  // magistrate loader "because tr_officers is loaded before it in db:refresh" —
  // but db:load:tr:pg is a documented db:refresh EXCLUSION, so on the routine TR
  // path (tr:daily-refresh, db:load:tr:pg:cloud) nothing was refreshing it. It was
  // invisible only because 003's CASCADE deleted the matview outright; with the
  // relation now surviving, staleness is what is left to close.
  // Non-blocking: this matview is READ on a serving path (magistrate_politician_links()
  // in 071, and 099), so a plain REFRESH would block those readers for its whole
  // duration on every TR load. 071 supplies the UNIQUE index that allows it, and owns
  // the object — a TR-only database may not have it at all, which the helper skips.
  await refreshMatviewConcurrently("company_officer_counts");

  // Person-page portfolio rollups (procurement / by-cabinet / inner circle) —
  // depend on tr_officers + contracts + cabinets + officer_name_counts (above).
  await exec(readFileSync(PERSON_API_SQL, "utf8"));
  // The by-company / by-settlement cuts (migration 125) extend the above; applied here so a
  // rebuild creates them and person_procurement_breakdowns.data.test.ts passes without a
  // manual apply.
  await exec(readFileSync(PERSON_BREAKDOWNS_SQL, "utf8"));

  // Curated company↔politician links (from mp_connected / pep_connected) → PG,
  // so the person page's political connections come straight from the DB.
  const links: Array<
    [string, string, string, string, string | null, number | null, string]
  > = [];
  if (existsSync(MP_JSON)) {
    const mp = JSON.parse(readFileSync(MP_JSON, "utf8")) as {
      entries: Array<{
        mpId: number;
        mpName: string;
        contractorEik: string;
        relations?: Array<{ kind?: string }>;
        totalEur?: number;
      }>;
    };
    for (const e of mp.entries)
      links.push([
        e.contractorEik,
        e.mpName,
        `/candidate/mp-${e.mpId}`,
        "mp",
        e.relations?.[0]?.kind ?? null,
        e.totalEur ?? null,
        JSON.stringify(e.relations ?? []),
      ]);
  }
  if (existsSync(PEP_JSON)) {
    const pep = JSON.parse(readFileSync(PEP_JSON, "utf8")) as {
      entries: Array<{
        slug: string;
        name: string;
        contractorEik: string;
        role?: string;
        totalEur?: number;
        relations?: Array<{ role?: string }>;
      }>;
    };
    for (const e of pep.entries)
      links.push([
        e.contractorEik,
        e.name,
        `/officials/${e.slug}`,
        "official",
        e.role ?? null,
        e.totalEur ?? null,
        JSON.stringify(e.relations ?? []),
      ]);
  }
  await exec("TRUNCATE company_politicians");
  if (links.length)
    await copyTable(
      "company_politicians",
      ["eik", "politician", "ref", "kind", "role", "total_eur", "relations"],
      links,
    );

  // Awarder K-Index (politician/NGO-board-linked-supplier share per awarder) —
  // depends on contracts + the company_politicians just loaded. The migration
  // creates the fn + (re)builds the ranking matview. Skipped cleanly if the
  // contracts table isn't present yet (TR-only load before a contract load).
  const KINDEX_SQL = fileURLToPath(
    new URL("./schema/pg/039_awarder_kindex.sql", import.meta.url),
  );
  // Multi-component A–F risk grade (buyer + supplier) — same deps as the K-Index
  // (contracts + company_politicians), so applied in the same guarded block.
  const RISK_GRADE_SQL = fileURLToPath(
    new URL("./schema/pg/041_procurement_risk_grade.sql", import.meta.url),
  );
  // Per-NGO public-interest signals (Phase 1: public-money) + the list matview.
  // Composes contracts + fund_projects + ngo_funding + supplier_risk_grade, so
  // applied only when ALL of those are present (guarded below).
  const NGO_SIGNALS_SQL = fileURLToPath(
    new URL("./schema/pg/080_ngo_signals.sql", import.meta.url),
  );
  const hasContracts = await getPool()
    .query("SELECT to_regclass('public.contracts') AS t")
    .then((r) => r.rows[0]?.t != null)
    .catch(() => false);
  if (hasContracts) {
    await exec(readFileSync(KINDEX_SQL, "utf8"));
    await exec(readFileSync(RISK_GRADE_SQL, "utf8"));
    // 041 rebuilt the ranking matview from fresh company_politicians; repopulate
    // the per-scope serving table so the leaderboard doesn't go stale (F-007).
    await withClient((c) => rebuildRiskGradeScoped(c));
    // The per-scope precomputes built from the two tables this loader just replaced.
    // company_politicians is TRUNCATE+reloaded above, and it is the politician↔company link
    // set the MP-tied money on the whole procurement dashboard is computed from; tr_companies
    // supplies contractor display names. Without this a TR reload moves every MP-tied figure
    // everywhere on the site EXCEPT /procurement/contractors and the six /procurement
    // dashboard routes, which keep serving the previous link set at a 200 — the same silent
    // staleness lib/scopedMatviews exists to prevent, and the reason 122's and 124's `inputs`
    // name these tables. Only those two matviews: 119 and 123 read neither.
    //
    // Guarded because a TR-only database may predate the migrations; refreshScopedPrecomputes
    // already skips a matview that does not exist, so this only has to survive the call.
    await refreshScopedPrecomputes(["company_politicians", "tr_companies"]);
    // Same reason, different precompute: budget_admin_procurement (157) counts
    // DISTINCT politician-linked contractors per spending unit, straight out of
    // the company_politicians this loader just replaced. Without it every
    // ministry row on /budget/ministries keeps the previous link set's flag at a
    // 200 — the third trigger, after the budget loader (its own dimension) and
    // load_pg (the contracts corpus). Guarded on the FUNCTION, since that is
    // what is called; a database with the table and no function raises 42883.
    const hasAdminProc = await getPool()
      .query(
        "SELECT to_regprocedure('public.rebuild_budget_admin_procurement()') AS t",
      )
      .then((r) => r.rows[0]?.t != null)
      .catch(() => false);
    if (hasAdminProc) {
      await exec("SELECT rebuild_budget_admin_procurement()");
      await vacuumAfterReload("budget_admin_procurement");
    }
    // NGO signals (080) also need fund_projects + ngo_funding. Apply + REFRESH
    // only when both are present too — a TR-only DB (before an ИСУН / funding
    // load) skips it cleanly. load_ngo_funding_pg.ts re-refreshes after funding.
    const hasNgoDeps = await getPool()
      .query(
        "SELECT to_regclass('public.fund_projects') AS f, to_regclass('public.ngo_funding') AS n",
      )
      .then((r) => r.rows[0]?.f != null && r.rows[0]?.n != null)
      .catch(() => false);
    if (hasNgoDeps) {
      await exec(readFileSync(NGO_SIGNALS_SQL, "utf8"));
      // Connection signals: rebuild ngo_board_links from the fresh officers +
      // the magistrate roster + the persisted official_roster. Guarded on the
      // magistrate table (the rebuild fn joins it; may not be loaded on a TR-only
      // DB). NOTE: the official leg matches against whatever official_roster was
      // last loaded by db:load:ngo-board-links — on a routine TR refresh that
      // roster may be older than the current officials dataset (officials change
      // slowly, so acceptable; re-run db:load:ngo-board-links to refresh it).
      const hasMagistrate = await getPool()
        .query("SELECT to_regclass('public.magistrate') AS t")
        .then((r) => r.rows[0]?.t != null)
        .catch(() => false);
      if (hasMagistrate) await exec("SELECT rebuild_ngo_board_links()");
      // Matview is created WITH NO DATA; a plain REFRESH populates it (~2s over
      // ~31k NGOs). Not CONCURRENTLY — it may be unpopulated on the first run.
      await exec("REFRESH MATERIALIZED VIEW ngo_signals");
      // Rebuild the contract-page foreign-funding disclosure feed, then refresh
      // the risk-indexes cache so /api/db/procurement-risk-indexes serves it.
      // Gate on the TARGET TABLE itself (owned by migration 033, applied by the
      // separate procurement loader) — `hasContracts` above is only a practical
      // proxy and is stale-033-vulnerable, so guard the exact object we touch.
      const hasLinkTable = await getPool()
        .query("SELECT to_regclass('public.procurement_ngo_foreign_link') AS t")
        .then((r) => r.rows[0]?.t != null)
        .catch(() => false);
      if (hasLinkTable) {
        await exec("SELECT rebuild_procurement_ngo_foreign_link()");
        const hasRiskCache = await getPool()
          .query(
            "SELECT to_regclass('public.procurement_risk_indexes_cache') AS t",
          )
          .then((r) => r.rows[0]?.t != null)
          .catch(() => false);
        if (hasRiskCache)
          await exec(
            "REFRESH MATERIALIZED VIEW procurement_risk_indexes_cache",
          );
      }
    }
  }

  // Declared stakes → public contracts (096) resolves a declared company NAME against
  // tr_companies and confirms the person against tr_person_roles / tr_officers, so a TR
  // ingest invalidates it: without this refresh the conflict-of-interest surface keeps
  // serving pre-ingest links, and nothing in the declarations loader would notice (that
  // path only rebuilds the matview when declarations themselves are reloaded).
  //
  // Non-blocking, so /person keeps serving through the rebuild — 096 supplies the UNIQUE
  // index on (declaration_id, seq, uic) that allows it, and owns the object, so a database
  // where the declarations loader has never run is skipped rather than failed.
  await refreshMatviewConcurrently("declaration_stake_company");

  // person_browse_table (120) — the third matview 003's CASCADE used to delete —
  // is deliberately NOT refreshed here. It folds six upstream datasets and is a
  // ~minute rebuild; owning it from the TR loader would invert the layering the
  // same way recreating the dropped dependents would. tr_officers is only one of
  // its inputs (the company counts), so after a TR ingest it is STALE in that one
  // column rather than wrong everywhere — a state /persons serves correctly at a
  // 200. The fix is the documented one: re-run db:load:persons-browse:pg[:cloud]
  // after a TR load. CLAUDE.md's persons-browse section names db:load:tr:pg as a
  // trigger for exactly this reason.

  await exec(
    "CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text)",
  );
  await withClient(async (c) => {
    for (const [k, v] of [
      ["tr_schema_version", "pg/003_tr_search.sql"],
      ["tr_generated_at", new Date().toISOString()],
      ["tr_code_git_sha", gitSha()],
      ["tr_companies", String(companies.length)],
      ["tr_officers", String(officers.length)],
    ])
      await c.query(
        "INSERT INTO meta (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [k, v],
      );
  });

  return {
    companies: companies.length,
    officers: officers.length,
    companiesNew: ingest?.rowsNew ?? 0,
  };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!existsSync(TR_DB)) {
    console.error(`No TR store at ${TR_DB} — run the TR ingest first.`);
    process.exit(1);
  }
  const t0 = Date.now();
  loadTrPg()
    .then(async ({ companies, officers, companiesNew }) => {
      console.log(
        `loaded ${companies} companies (${companiesNew} new) + ${officers} officers → Postgres in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      await end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
