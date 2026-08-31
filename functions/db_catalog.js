// The ONE classification of what /db lists, shared by the deployed function
// (sql_lib.js) and the dev server (vite/sql-browser.ts). Those two carried
// near-verbatim copies of readSchema under a "keep the two in sync" comment;
// one copy, or dev and prod drift.
//
// Why this exists: of 265 relations on production, 57 are not data — scratch
// tables a human left behind (_pwy_before at 33,026 rows, tmp_all_slugs at
// 20,887), ingest plumbing, extension views, precompute caches and serving
// blobs. `_pwy_before` was the FIRST entry a visitor saw.
//
// ── Rule-first, exception-second ──────────────────────────────────────────
// A handful of patterns plus a named list, never a hand-maintained allowlist of
// every real table: an allowlist means each new loader ships a relation that is
// invisible until somebody remembers it — the SCOPED_MATVIEWS failure mode.
//
// ── Fail OPEN ─────────────────────────────────────────────────────────────
// Anything matching no rule is "data" and is shown. A new dataset appearing
// unannounced is a small annoyance; a new dataset silently hidden is the defect
// this file exists to prevent, and it would be invisible precisely because the
// thing you would look for is missing.
//
// ⚠️ This is NOT a security boundary, and must never be made one. app_readonly
// holds SELECT on everything (roles_readonly.sql), so a relation hidden from
// the listing is still queryable by name. The console's contract is "read
// anything, but be shown what matters". Keeping a genuinely sensitive relation
// out of reach is a REVOKE in the database, not a filter in this file.

/** Never listed: scratch, plumbing, extension views. */
const INTERNAL_PATTERNS = [
  /^_/, // _pwy_before, _pp_bak, _pid_before, _shard_keys
  /^tmp_/, // tmp_all_slugs, tmp_rank_slugs
  /^pg_stat_statements/, // extension views
  /_stage$/, // price_stage and any future UNLOGGED load stage
];

/** Never listed: named plumbing no pattern catches. */
const INTERNAL_NAMES = new Set([
  // ingest bookkeeping — about HOW data arrived, not about any dataset
  "meta",
  "ingest_batches",
  "ingest_first_seen",
  "changelog_days",
  "contract_first_seen",
  "mp_roster_meta",
  // identity-resolver state, spanning every people dataset
  "person_slug_lock",
  "person_slug_retired",
  "person_review_candidate",
  "person_link_evidence",
  "person_link_override",
  // operator overrides
  "price_product_overrides",
  // NOT person_source: it is UNCLAIMED on the map (no dataset owns it) but it
  // is a 22-row controlled vocabulary — the legend for person_role.source — so
  // it is worth reading. "Which dataset owns this" and "should /db list this"
  // are different questions and are allowed to disagree.
]);

/** Shown under "derived": real, but computed from something else in the list. */
const DERIVED_PATTERNS = [
  /_cache$/, // procurement_payloads-style precomputes
  /_payloads$/, // serving blobs
  /_search$/, // trigram search indexes
  /_search_text$/,
  /_name_counts$/, // officer_name_counts, owner_name_counts
  /^risk_/, // contract-risk internals
  /_rank$/, // contractor_rank
  /_ranking$/,
];
// NOT `_coverage$`. All five (ted_coverage, adfi_coverage, aop_expert_coverage,
// isun_clean_delivery_coverage, nzok_payment_coverage) are claimed as
// DatasetDef.tables[] members, and each is the ONLY home of a caveat CLAUDE.md
// requires every consumer to print — ted_coverage's per-year counts are what
// keep TED's index ramp from reading as "Bulgaria published nothing", and
// isun_clean_delivery_coverage.absence_meaning is NOT NULL precisely so a row
// without that sentence cannot exist. Hiding them behind a toggle hides the
// caveat, not a precompute.

const DERIVED_NAMES = new Set([
  "company_officer_counts",
  "appealed_ocids",
  "upheld_ocids",
]);

/**
 * @param {string} name  relation name (unqualified)
 * @param {string} [schema]
 * @returns {"data"|"derived"|"internal"}
 */
function classifyRelation(name, schema) {
  if (schema && schema !== "public") return "internal";
  if (INTERNAL_NAMES.has(name)) return "internal";
  if (INTERNAL_PATTERNS.some((re) => re.test(name))) return "internal";
  if (DERIVED_NAMES.has(name)) return "derived";
  if (DERIVED_PATTERNS.some((re) => re.test(name))) return "derived";
  return "data"; // fail open
}

/**
 * The catalogue queries, shared so the deployed function and the dev server
 * cannot drift. They were four byte-identical statements in two files under a
 * "keep the two in sync" comment.
 */
const SCHEMA_SQL = {
  tables: `SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS kind,
            COALESCE(st.n_live_tup, c.reltuples)::bigint AS est
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_stat_user_tables st ON st.relid = c.oid
     WHERE c.relkind IN ('r','v','m')
       AND n.nspname NOT IN ('pg_catalog','information_schema')
       AND n.nspname NOT LIKE 'pg_temp%'
     ORDER BY n.nspname, c.relname`,
  columns: `SELECT table_schema AS schema, table_name AS tbl, column_name AS col,
            data_type AS typ, is_nullable AS nullable
     FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog','information_schema')
     ORDER BY table_schema, table_name, ordinal_position`,
  primaryKeys: `SELECT tc.table_schema AS schema, tc.table_name AS tbl,
            kcu.column_name AS col
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY'
       AND tc.table_schema NOT IN ('pg_catalog','information_schema')`,
};

module.exports = {
  classifyRelation,
  SCHEMA_SQL,
  INTERNAL_PATTERNS,
  INTERNAL_NAMES,
  DERIVED_PATTERNS,
  DERIVED_NAMES,
};
