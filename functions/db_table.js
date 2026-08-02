// Server-side table engine for the DB browse pages. ONE generic endpoint
// (/api/db/table) + a per-resource whitelist registry drives backend
// pagination, sorting, filtering and aggregation for every DB-backed table
// (company/awarder contracts, annexes, and future global browsers over
// contracts/tenders/companies).
//
// SECURITY: the client never sends SQL or raw identifiers. Every column id,
// operator, sort direction and scope column is validated against the resource
// registry; only whitelisted identifiers reach the SQL string, and every value
// is a bound parameter ($1, $2, …). Runs under the app_readonly role + READ ONLY
// tx + statement_timeout (see functions/index.js, sql_lib.js).
//
// Shared by functions/index.js (prod) and vite/db-api.ts (dev) so dev == prod.
// See docs/plans/pg-query-performance.md + postgres-migration-v1.md.

const snakeToCamel = (s) =>
  s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/**
 * A malformed REQUEST — the caller named a resource/column that does not exist,
 * or left a `required` filter empty. NOT a server fault, so the route maps it to
 * 400 (see db_routes.js `table`/`facets`).
 *
 * WHY a distinct class rather than a bare Error: everything thrown out of this
 * module lands in the Cloud Function's catch-all, which answers 500. That put 70
 * requests over 2026-07-28…07-31 — every one an `awarder_ekatte` sent empty,
 * rejected in <10 ms before a single query ran — into the same bucket as a
 * statement_timeout, making it the third-largest source of 500s on the `db`
 * service. A 500 has to keep meaning "the server broke", or the bucket stops
 * being a signal. See docs/plans/db-route-timeouts-v1.md §9.2.
 *
 * The split is by BLAME, not by call site: a bad `semiJoinSql` template or a
 * `defaultFilter` naming a missing column is a REGISTRY bug reached through the
 * same functions, and those keep throwing a plain Error so they keep 500-ing —
 * they are a deploy defect no caller can avoid, and demoting them to 400 would
 * hide them behind whatever request happened to trip them.
 *
 * `expose` marks the message safe to return verbatim: every one is built from
 * registry identifiers plus the caller's own ids, never from row data.
 */
class DbRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "DbRequestError";
    this.status = 400;
    this.expose = true;
  }
}

// ---- resource registry -------------------------------------------------------
// Per dataset: base table, allowed scope columns, and a column whitelist. Each
// column flags what the client may do with it: sort, filter (+ how), search
// (global text), agg. `type` picks the filter/predicate shape.
//
// `facet: true` is a fourth, narrower permission: this column may be GROUPed for a
// /api/db/facets vocabulary even though it is not filterable. It exists for a column that
// is the only place a vocabulary lives while being the wrong thing to filter — persons
// `oblast_code` is the person's representative seat, so filtering it would drop people
// from an oblast they genuinely serve, but the padded `oblast_codes` set it is filtered
// through cannot be GROUP BY'd. A filterable column is facetable already; do NOT add
// `facet: true` beside a `filter`, which is inert config (db_table.test.js guards it).
const REGISTRY = {
  contracts: {
    // contracts_list = contracts + a per-row КЗК-appeal flag via the appealed-
    // ocids matview (migration 042); a view over the base, filters/sorts intact.
    // ⚠ Hard dep on migration 042 (no base-table fallback here — the projection
    // selects has_appeal/appeal_upheld): apply 042 to Cloud SQL BEFORE functions:db,
    // else 42P01. `db:load:tenders:pg:cloud` applies it; so does apply_functions.ts.
    // ⚠ This resource can also read `awarder_seats` (021), via the awarder_ekatte
    // semi-join below — so that table must exist and be CURRENT on any database
    // serving this resource. Reloading it no longer affects only the by-settlement
    // rollup; it changes which contracts the browser shows for a place.
    base: "contracts_list",
    // The count+sum aggregate and the facet GROUP BYs reference only base columns,
    // so they run against `contracts` directly — the contracts_list view's LEFT
    // JOINs (appeal flags, risk cache) block index-only scans, so aggregating over
    // the view makes the covering indexes (migration 113) useless. Routed via
    // aggBaseFor(), which falls back to the view the moment a WHERE clause or facet
    // touches a viewOnly column below. See 113_procurement_browser_covering_indexes.sql.
    aggBase: "contracts",
    scopeCols: ["contractor_eik", "awarder_eik"],
    columns: {
      // filter:"in" so the project-file resolver can fetch a member set by
      // contract key (key IN (...)) — the УНП spine's contract-side seek.
      key: { type: "text", filter: "in" },
      // The УНП lineage key (migration 049; exposed via contracts_list c.*).
      // filter:"in" so the resolver can pull every contract of a procedure
      // (unp IN (...)) — the contract↔tender join that threads the timeline.
      unp: { type: "text", filter: "in" },
      ocid: { type: "text" },
      // Projected (badge) but NOT filterable: has_appeal/appeal_upheld are
      // LEFT-JOIN flags (ao.ocid IS NOT NULL), so `WHERE flag = $1` can't reduce
      // the join → a full-corpus scan twice per request. Re-add a filter only via
      // a matview semi-join if a UI ever needs it.
      // viewOnly: added by the contracts_list view (LEFT JOIN), absent from the
      // base table — a request filtering/faceting on these must aggregate over the
      // view, not aggBase. See aggBaseFor().
      has_appeal: { type: "bool", viewOnly: true },
      appeal_upheld: { type: "bool", viewOnly: true },
      tag: { type: "text", filter: "in" },
      date: { type: "date", sort: true, filter: "range" },
      date_signed: { type: "date" },
      // filter:"in" (not "eq") so a sector browse pack can pass an EIK-set
      // (awarder_eik IN (...)) as a fixedFilter — the builder wraps a scalar in
      // an array, so single-value callers are unaffected. See the water/judiciary
      // SECTOR_BROWSE_PACKS seam (docs/plans/water-view-v1.md §4.3).
      awarder_eik: { type: "text", filter: "in" },
      // VIRTUAL column (filter:"semijoin") — the settlement scope behind
      // /procurement/settlement/:ekatte. `contracts` has no place column; a buyer's
      // seat lives in awarder_seats, so "procurement in Варна" is "every contract
      // whose awarder is seated at this EKATTE".
      //
      // Deliberately NOT a denormalised contracts column and NOT a join in the
      // contracts_list view: the first needs a backfill after every TRUNCATE+COPY
      // reload (invisible when it goes stale), the second taxes every contracts
      // query and would push aggregates off the migration-113 covering indexes.
      // As a plain filter it also rides `fixedFilters`, which the table, facet and
      // aggregate paths all thread already.
      //
      // is_local_hq mirrors procurement_by_settlement() (030): central ministries
      // and national state companies are geo-resolved but procure nationally, so
      // they belong to the "national" rollup rather than to their seat's page.
      // MEASURED (София, 327 buyers / 64,609 contracts): page 1.9ms, count+sum
      // 54ms, facets ~30ms. See docs/plans/procurement-settlement-browser-v1.md §1.4.
      awarder_ekatte: {
        type: "text",
        filter: "semijoin",
        // The scope, not a refinement: an absent value must throw, never widen to
        // the national corpus. See the `required` note in buildFilter.
        required: true,
        semiJoinCol: "awarder_eik",
        semiJoinSql:
          "SELECT eik FROM awarder_seats WHERE source = 'geo' AND is_local_hq AND ekatte = ?",
      },
      awarder_name: { type: "text", sort: true, filter: "text", search: true },
      // filter:"in" (not "eq") — mirrors awarder_eik: the project-file resolver
      // scopes a CONTRACTOR-anchored thread by passing a contractor-EIK set
      // (contractor_eik IN (...)); the builder wraps a scalar in an array, so
      // single-value callers are unaffected.
      contractor_eik: { type: "text", filter: "in" },
      // VIRTUAL semijoin columns (filter:"semijoin") — the PERSON scope behind
      // /person/:name/contracts + the person portfolio browser. `contracts` has no person
      // column; a person's firms live in the TR graph, so "contracts of Иван Петров" is
      // "every contract whose contractor is one of the companies the person is an officer of".
      // Two variants, one per person screen, each deriving the EIK set the SAME way its KPI
      // source does (docs/plans/person-procurement-browser-v1.md §3.1), so the browser rows
      // reconcile with the headline totals:
      //   • _name → tr_officers.name_fold, matches person_procurement (024). Excludes the TR
      //     redaction sentinel 'заличено обстоятелство' so a placeholder never scopes to 777
      //     unrelated firms (a no-op for any real person). The subquery is not subject to
      //     MAX_IN_VALUES, so a hub name's ~2k firms pass through where a client `in`-array
      //     would truncate.
      //   • _slug → person_role.ref (high-confidence TR roles), matches person_by_slug (082).
      // required:true — an absent value throws (fails closed), exactly like awarder_ekatte;
      // dropped, this would widen to the national corpus under one person's heading.
      //
      // ⚠ PAIR WITH not_consortium_member. To reconcile with the person_procurement headline
      // the caller MUST also send { id:"not_consortium_member", value:"member" } — the headline
      // count excludes €0 consortium-member rows (024:47-48). This is NOT a defaultFilter,
      // because the SAME contracts resource backs the settlement/awarder browsers, which must
      // KEEP member rows. Forgetting the pairing over-counts silently at a 200. The person
      // contracts browser (Tier 3) is the only caller of these columns; its route test asserts
      // the pairing.
      contractor_of_person_name: {
        type: "text",
        filter: "semijoin",
        required: true,
        semiJoinCol: "contractor_eik",
        semiJoinSql:
          "SELECT DISTINCT uic FROM tr_officers WHERE name_fold = translit_bg_latin(?) " +
          "AND name_fold <> 'zalicheno obstoyatelstvo.'",
      },
      contractor_of_person_slug: {
        type: "text",
        filter: "semijoin",
        required: true,
        semiJoinCol: "contractor_eik",
        semiJoinSql:
          "SELECT r.ref FROM person_role r JOIN person p ON p.person_id = r.person_id " +
          "WHERE p.slug = ? AND p.status = 'active' AND p.is_public_figure " +
          "AND r.source = 'tr' AND r.confidence IN ('exact_id','high','manual')",
      },
      // Logical filter over the physical `consortium_role`: exclude €0 consortium-member
      // rows so the person browser's count/Σ match person_procurement's basis (024:47-48).
      // filter:"isdistinct" (NULL-safe) — `!= 'member'` would drop the ~99% NULL rows.
      not_consortium_member: {
        type: "text",
        filter: "isdistinct",
        col: "consortium_role",
      },
      contractor_name: {
        type: "text",
        sort: true,
        filter: "text",
        search: true,
      },
      // Free-text subject: global search matches it the way the combined-search
      // dropdown does — prefix-AND FTS + trigram fallback over title_fold
      // (searchText), not a raw contiguous substring (which returned 0 for any
      // multi-word / punctuated "see all" deep link). idx_contracts_title_fts +
      // idx_contracts_title_fold_trgm back both passes.
      title: {
        type: "text",
        filter: "text",
        search: true,
        searchCol: "title_fold",
        searchText: true,
      },
      amount: { type: "number" },
      currency: { type: "text" },
      amount_eur: { type: "number", sort: true, filter: "range", agg: "sum" },
      // At-signing value (present only when an annex moved it) — surfaced so the
      // annex value-growth risk flag is computable on browser rows too.
      signing_amount_eur: { type: "number" },
      // facetExpr groups the facet dropdown by CPV DIVISION (2-digit prefix)
      // instead of the full code; selecting one sends a prefix filter (cpv LIKE
      // '45%'). The client maps the division code → name via cpvDivisionName.
      cpv: { type: "text", filter: "prefix", facetExpr: "left(cpv, 2)" },
      procurement_method: { type: "text", sort: true, filter: "in" },
      procurement_method_rationale: { type: "text" },
      // DB-recovered обособена позиция name (migration 050) — the project-file
      // timeline groups a procedure's contracts by lot.
      lot_name: { type: "text" },
      // Consortium / framework attribution (migration 087). joint_kind =
      // 'consortium'|'framework'; consortium_role = 'carrier'|'member'. The project
      // fold reads these to treat €0 member rows as participants, not money-winners.
      joint_kind: { type: "text", filter: "in" },
      consortium_role: { type: "text", filter: "in" },
      consortium_eik: { type: "text", filter: "eq" },
      consortium_full_eur: { type: "number" },
      category: { type: "text", filter: "in" },
      number_of_tenderers: {
        type: "int",
        sort: true,
        filter: "range",
      },
      eu_funded: { type: "int", filter: "eq" },
      eu_program: { type: "text" },
      tender_period_start_date: { type: "date" },
      tender_period_end_date: { type: "date" },
      bundle_uuid: { type: "text" },
      source_url: { type: "text" },
      // Per-contract risk index (112 → contracts_list). Declared `number`, not
      // `text`: the facet NULL-guard branches on type. The grade takes
      // filter:"in" so it is multi-select AND facetable in one declaration;
      // sorting it lexically is honest here because A<B<…<F is the risk order
      // (unlike `procedure`, which every screen leaves unsortable for that reason).
      // viewOnly: sourced from contract_risk_cache via the view (see above).
      risk_cri: { type: "number", sort: true, filter: "range", viewOnly: true },
      risk_grade: { type: "text", sort: true, filter: "in", viewOnly: true },
      // sort:true so the "riskiest contracts" board can order by fired count.
      // Ordering by risk_cri would be subtly wrong: the CRI divides by a varying
      // denominator, so a 4-of-11 (36) sorts below a 3-of-8 (38).
      risk_fired: { type: "int", sort: true, viewOnly: true },
      risk_available: { type: "int", viewOnly: true },
      risk_fired_mask: { type: "int", viewOnly: true },
      risk_available_mask: { type: "int", viewOnly: true },
    },
    // Projection returned to the client (camelCased). ProcurementContract-shaped
    // so the client can reuse the risk scorer + row components.
    select: [
      "key",
      "unp",
      "ocid",
      "tag",
      "date",
      "date_signed",
      "awarder_eik",
      "awarder_name",
      "contractor_eik",
      "contractor_name",
      "title",
      "amount",
      "currency",
      "amount_eur",
      "signing_amount_eur",
      "cpv",
      "procurement_method",
      "procurement_method_rationale",
      "lot_name",
      "category",
      "number_of_tenderers",
      "eu_funded",
      "eu_program",
      "tender_period_start_date",
      "tender_period_end_date",
      "bundle_uuid",
      "source_url",
      "has_appeal",
      "appeal_upheld",
      "joint_kind",
      "consortium_role",
      "consortium_eik",
      "consortium_full_eur",
      "risk_cri",
      "risk_grade",
      "risk_fired",
      "risk_available",
      "risk_fired_mask",
      "risk_available_mask",
    ],
    defaultSort: [["date", "desc"]],
    aggregates: [{ fn: "count" }, { fn: "sum", col: "amount_eur" }],
    maxPageSize: 100,
  },
  // ЦАИС ЕОП tender-stage procedures (estimated/forecast value, NOT spend).
  // Scoped to a buyer for the per-awarder pipeline; also a global tenders browser.
  tenders: {
    // tenders_list = tenders + a per-row КЗК-appeal flag (migration 042); a view
    // over the base table, so all filters/sorts still resolve.
    base: "tenders_list",
    // Aggregate/facet over the base `tenders` table (index-only via migration 113);
    // the tenders_list view's appeal LEFT JOIN blocks it. Falls back to the view
    // when a WHERE/facet touches a viewOnly column. See aggBaseFor().
    aggBase: "tenders",
    scopeCols: ["buyer_eik"],
    columns: {
      // filter:"in" so the project-file resolver can fetch procedures by УНП
      // set (unp IN (...)) — the tender side of the contract↔tender spine.
      unp: { type: "text", filter: "in" },
      ocid: { type: "text" },
      // Projected badge, not filterable — correlated EXISTS can't be index-driven
      // as a WHERE predicate (full ~125k scan). See the contracts note above.
      // viewOnly: added by the tenders_list view (appeal LEFT JOIN). See aggBaseFor().
      has_appeal: { type: "bool", viewOnly: true },
      appeal_suspended: { type: "bool", viewOnly: true },
      publication_date: { type: "date", sort: true, filter: "range" },
      // filter:"in" so a sector browse pack can pass an EIK-set (buyer_eik IN
      // (...)) as a fixedFilter — same as contracts.awarder_eik. Scalar callers
      // are unaffected (the builder wraps a scalar in an array).
      buyer_eik: { type: "text", filter: "in" },
      // Global search hits the transliterated fold columns (gin_trgm-indexed);
      // the raw buyer_name/subject have no trigram index, so a raw ILIKE '%q%'
      // seq-scans the ~125k-row corpus (~350ms) — the fold path is ~2-20ms for
      // identical results. See idx_tenders_{buyer,subj}_fold (009_tenders.sql).
      buyer_name: {
        type: "text",
        sort: true,
        filter: "text",
        search: true,
        searchCol: "buyer_fold",
        searchFold: true,
      },
      subject: {
        type: "text",
        filter: "text",
        search: true,
        searchCol: "subject_fold",
        searchText: true,
      },
      procedure_type: { type: "text", sort: true, filter: "in" },
      // Exact-code `in` (not division prefix) so a curated topic deep-link can
      // filter by its precise CPV set (e.g. guardrails → 45233292, 34928…).
      // facetExpr groups the facet dropdown by 2-digit CPV DIVISION (feeds the
      // shared CpvFilterCombobox) — faceting only, the `in` filter is unaffected.
      cpv: { type: "text", filter: "in", facetExpr: "left(cpv, 2)" },
      // Same physical `cpv` column, but a PREFIX match — backs the tender
      // normalcy panel's "browse similar" link (cohort CPV prefix, 2–8 digits).
      cpv_prefix: { type: "text", filter: "prefix", col: "cpv" },
      cpv_desc: { type: "text" },
      estimated_value_eur: {
        type: "number",
        sort: true,
        filter: "range",
        agg: "sum",
      },
      currency: { type: "text" },
      // Surfaced (not filterable) so the browser can compute the ex-ante
      // rushed-window risk flag client-side (publication_date → deadline).
      submission_deadline: { type: "text" },
      lots_count: { type: "int", sort: true, filter: "range" },
      is_cancelled: { type: "bool", filter: "eq" },
      is_framework_agreement: { type: "bool", filter: "eq" },
      is_eu_funded: { type: "bool", filter: "eq" },
      link_to_oj_eu: { type: "text" },
    },
    select: [
      "unp",
      "ocid",
      "publication_date",
      "buyer_eik",
      "buyer_name",
      "subject",
      "procedure_type",
      "cpv",
      "cpv_desc",
      "estimated_value_eur",
      "currency",
      "submission_deadline",
      "lots_count",
      "is_cancelled",
      "is_framework_agreement",
      "is_eu_funded",
      "link_to_oj_eu",
      "has_appeal",
      "appeal_suspended",
    ],
    defaultSort: [["estimated_value_eur", "desc"]],
    aggregates: [{ fn: "count" }, { fn: "sum", col: "estimated_value_eur" }],
    maxPageSize: 100,
  },
  // ИСУН EU-funds per-project table (fund_projects). Scoped to a beneficiary EIK
  // for the per-company funds drill-down; also usable as a global funds browser.
  fund_projects: {
    base: "fund_projects",
    scopeCols: ["beneficiary_eik"],
    columns: {
      // `in` filter so the project-file resolver can pull curated fund members by
      // contract_number (the ИСУН member spine, §4.2.3b) — mirrors the unp/key
      // spine on contracts/tenders.
      contract_number: { type: "text", filter: "in" },
      beneficiary_eik: { type: "text", filter: "eq" },
      beneficiary_name: {
        type: "text",
        sort: true,
        filter: "text",
        search: true,
      },
      program_code: { type: "text", filter: "eq" },
      program_name: { type: "text", sort: true, filter: "in", search: true },
      title: { type: "text", filter: "text", search: true },
      total_eur: { type: "number", sort: true, filter: "range", agg: "sum" },
      grant_eur: { type: "number", sort: true, filter: "range", agg: "sum" },
      own_cofinance_eur: { type: "number", sort: true, filter: "range" },
      paid_eur: { type: "number", sort: true, filter: "range", agg: "sum" },
      duration_months: { type: "int", sort: true, filter: "range" },
      status: { type: "text", sort: true, filter: "in" },
      org_type: { type: "text", filter: "in" },
      oblast: { type: "text", filter: "in" },
    },
    select: [
      "contract_number",
      "beneficiary_eik",
      "beneficiary_name",
      "program_code",
      "program_name",
      "title",
      "total_eur",
      "grant_eur",
      "own_cofinance_eur",
      "paid_eur",
      "duration_months",
      "status",
      "org_type",
      "oblast",
    ],
    defaultSort: [["total_eur", "desc"]],
    aggregates: [
      { fn: "count" },
      { fn: "sum", col: "total_eur" },
      { fn: "sum", col: "grant_eur" },
      { fn: "sum", col: "paid_eur" },
    ],
    maxPageSize: 100,
  },
  // Deduped officers/partners per company (matview company_person_roles) — the
  // standalone backend-paginated officers list for /db/company/:eik/officers.
  company_person_roles: {
    base: "company_person_roles",
    scopeCols: ["uic"],
    columns: {
      key: { type: "text" },
      uic: { type: "text", filter: "eq" },
      name: { type: "text", sort: true, filter: "text", search: true },
      role: { type: "text", sort: true, filter: "in" },
      share: { type: "number", sort: true, filter: "range" },
      share_amount: { type: "number" },
      share_currency: { type: "text" },
      added_at: { type: "date", sort: true, filter: "range" },
      erased_at: { type: "date" },
      active: { type: "int", filter: "eq" },
    },
    select: [
      "key",
      "uic",
      "name",
      "role",
      "share",
      "share_amount",
      "share_currency",
      "added_at",
      "erased_at",
      "active",
    ],
    defaultSort: [
      ["active", "desc"],
      ["share", "desc"],
    ],
    aggregates: [{ fn: "count" }],
    maxPageSize: 100,
  },

  // КЗК procurement-appeals browse (/procurement/appeals). base =
  // kzk_appeals_list (schema 042) = the whole appeals corpus + tender-derived
  // buyer name + resolved flag. No EIK scope column — the section scope (?pscope)
  // is applied as a complaint_date range filter, same as the tenders browser's
  // publication_date. ⚠ Hard dep on migration 042 reaching Cloud SQL (via
  // db:load:tenders:pg:cloud or apply_functions.ts) BEFORE functions:db.
  // 042 also carries an idempotent ALTER for `decision_act_no` (whose home is 131),
  // so it is self-sufficient here — but the column stays NULL everywhere until
  // `kzk:rejoin:cloud -- --apply` has run, and the browse simply shows no act.
  kzk_appeals: {
    base: "kzk_appeals_list",
    scopeCols: [],
    columns: {
      complaint_no: { type: "text" },
      complaint_date: { type: "date", sort: true, filter: "range" },
      unp: { type: "text" },
      buyer_eik: { type: "text", filter: "eq" },
      // buyer_name is the tenders-joined COALESCE (display only). Search targets
      // the base-table `respondent` instead so the count query keeps its LEFT
      // JOIN elimination — see the view comment in migration 042.
      buyer_name: { type: "text", sort: true, filter: "text" },
      respondent: { type: "text", filter: "text", search: true },
      complainant: { type: "text", sort: true, filter: "text", search: true },
      subject: { type: "text", filter: "text", search: true },
      status: { type: "text", filter: "in" },
      outcome: { type: "text", filter: "in" },
      decision_date: { type: "text" },
      // Provenance (131): the act that produced the outcome. NULL marks a
      // hand-seeded row. `filter: "eq"` so an auditor can pull every complaint one
      // act resolved — КЗК consolidates several into one ruling.
      decision_act_no: { type: "text", filter: "eq" },
      suspension: { type: "bool", filter: "eq" },
      vm_requested: { type: "bool", filter: "eq" },
      resolved: { type: "bool", filter: "eq" },
    },
    select: [
      "complaint_no",
      "complaint_date",
      "unp",
      "buyer_eik",
      "buyer_name",
      "complainant",
      "subject",
      "status",
      "outcome",
      "decision_date",
      "decision_act_no",
      "suspension",
      "vm_requested",
      "resolved",
    ],
    defaultSort: [["complaint_date", "desc"]],
    aggregates: [{ fn: "count" }],
    maxPageSize: 100,
  },

  // NGO (ЮЛНЦ) browse — сдружения/фондации/читалища + foreign branches. The
  // client sends a fixed `entity_class in (...)` filter to scope to the NGO
  // surface; entity_class/ngo_type are also user-facing facets.
  // Base is the `ngos_list` view (migration 080) = the ngo_signals matview joined
  // to tr_companies, so each row carries its precomputed public-interest signals.
  // Default sort surfaces the biggest public-money NGOs first; the client applies
  // a `has_signal` filter by default (with a "show all" toggle) so the ~28k
  // signal-less NGOs don't strand the browse in EIK order.
  ngos: {
    base: "ngos_list",
    scopeCols: [],
    columns: {
      uic: { type: "text" },
      name: { type: "text", sort: true, filter: "text", search: true },
      entity_class: { type: "text", sort: true, filter: "in" },
      ngo_type: { type: "text", sort: true, filter: "in" },
      seat: { type: "text", sort: true, filter: "text" },
      status: { type: "text", filter: "in" },
      signal_count: { type: "int", sort: true },
      public_money_eur: { type: "int", sort: true },
      has_signal: { type: "bool", filter: "eq" },
      // Space-joined signal codes — a `text` (ILIKE) filter backs the signal-code
      // picker ("show me foreign_funded"); the matview seq-scan is ~8ms.
      signal_codes: { type: "text", filter: "text" },
    },
    select: [
      "uic",
      "name",
      "entity_class",
      "ngo_type",
      "seat",
      "status",
      "signals",
      "signal_count",
      "public_money_eur",
      "has_signal",
      "signal_codes",
    ],
    defaultSort: [
      ["public_money_eur", "desc"],
      ["name", "asc"],
    ],
    aggregates: [{ fn: "count" }],
    maxPageSize: 100,
  },

  // Административен регистър (ИИСДА) services catalogue (/sector/administration/
  // services). One row per (service_id × provider tier); `name` is the free-text
  // search target (idx_admin_services_name_trgm), `tier` a facet filter. `id` is
  // the stable paging tiebreak (buildOrder appends select[0]).
  admin_services: {
    base: "admin_services",
    scopeCols: [],
    columns: {
      id: { type: "int" },
      // Opaque register ids (text) — no sort affordance: lexicographic order
      // ("1000" before "7") is meaningless and only confuses. Still filterable.
      service_id: { type: "text", filter: "text" },
      name: { type: "text", sort: true, filter: "text", search: true },
      tier: { type: "text", sort: true, filter: "in" },
    },
    select: ["id", "service_id", "name", "tier"],
    defaultSort: [["name", "asc"]],
    aggregates: [{ fn: "count" }],
    maxPageSize: 100,
  },

  // ДФ „Земеделие" subsidy payments browse (/subsidies/browse). Per (year ×
  // beneficiary × scheme) row; scoped by eik for the per-recipient page. year /
  // oblast / scheme are facet filters; name is the free-text search target.
  agri_subsidies: {
    base: "agri_subsidies",
    scopeCols: ["eik"],
    columns: {
      // id is the stable paging tiebreak (buildOrder appends select[0]). total_eur
      // ties are common (many identical scheme amounts), so the unique id keeps
      // paging deterministic AND makes ORDER BY total_eur DESC, id an index-only
      // walk on idx_agri_total / idx_agri_eik_total.
      id: { type: "int" },
      year: { type: "int", sort: true, filter: "in" },
      eik: { type: "text", filter: "eq" },
      name: { type: "text", sort: true, filter: "text", search: true },
      oblast: { type: "text", sort: true, filter: "in" },
      scheme: { type: "text", filter: "in" },
      // NOT search:true — scheme_desc has no trigram index, so OR-ing it into the
      // global search would force a full 2M-row seq scan per keystroke. Global
      // search targets `name` only (idx_agri_name_trgm). Still text-filterable.
      scheme_desc: { type: "text", filter: "text" },
      dp_eur: { type: "number", sort: true, filter: "range" },
      market_eur: { type: "number", sort: true, filter: "range" },
      rural_eur: { type: "number", sort: true, filter: "range" },
      total_eur: { type: "number", sort: true, filter: "range", agg: "sum" },
    },
    select: [
      "id",
      "year",
      "eik",
      "name",
      "oblast",
      "scheme",
      "scheme_desc",
      "dp_eur",
      "market_eur",
      "rural_eur",
      "total_eur",
    ],
    defaultSort: [["total_eur", "desc"]],
    aggregates: [{ fn: "count" }, { fn: "sum", col: "total_eur" }],
    maxPageSize: 100,
  },

  // Magistrates with a declared company (ИВСС чл. 175а ЗСВ) — the standalone
  // „виж всички" browse behind the /judiciary holdings tile (view
  // magistrate_holdings_table, migration 070). One row per holder (208); `companies`
  // is the flattened, searchable list so a reader can find every magistrate who named
  // a given company. Small set — no scope, no facets.
  magistrate_holdings: {
    base: "magistrate_holdings_table",
    scopeCols: [],
    columns: {
      name: { type: "text", sort: true, filter: "text", search: true },
      court: { type: "text", sort: true, filter: "text", search: true },
      company_count: { type: "int", sort: true, filter: "range" },
      companies: { type: "text", filter: "text", search: true },
    },
    select: ["name", "court", "company_count", "companies"],
    defaultSort: [["company_count", "desc"]],
    aggregates: [{ fn: "count" }],
    maxPageSize: 100,
  },

  // Officials asset leaderboard (matview officials_rankings_table, migration 100) —
  // replaces data/officials/assets-rankings.json(+-top). One row per PERSON holding a
  // Court-of-Audit officials role, NOT per officials slug: the JSON's 14,496 rows are
  // 13,346 people, because the same filing is stored once per slug there and once per
  // human here. See the migration header before "fixing" that row-count difference.
  //
  // is_exec / is_muni are the membership filters, NOT `source`: 503 people hold both an
  // executive and a municipal post, so the representative `source` cannot answer which
  // leaderboard they belong on. /officials/assets = is_exec true.
  //
  // net_worth_eur is NULL for TWO different facts, and `has_declaration` tells them apart:
  // true = filed but declared no valued assets (2,466 rows; the JSON wrote 0 for this
  // state), false = no declaration on record at all. The second population is EMPTY today —
  // the 154 rows that looked like non-filers before T0.1b were duplicate person rows whose
  // twin held the filings — but the distinction stays, because a newly appointed official
  // who has not yet filed is a real and reportable state. Do not label the two the same way:
  // "не е подал декларация" is a different claim from "—".
  officials_rankings: {
    base: "officials_rankings_table",
    scopeCols: [],
    columns: {
      slug: { type: "text" },
      // Display only — deliberately NOT filterable. Each person contributes ONE of their
      // officials refs here (the representative), so 1,700 of the 20,887 refs in
      // person_role never appear and a lookup by this column would return empty for them
      // while looking like a miss. Resolve an officials slug -> person against
      // person_role.ref instead (that is what the /officials/** 301 does).
      official_slug: { type: "text" },
      name: { type: "text", sort: true, filter: "text", search: true },
      category: { type: "text", sort: true, filter: "in" },
      source: { type: "text", filter: "in" },
      is_exec: { type: "bool", filter: "eq" },
      is_muni: { type: "bool", filter: "eq" },
      institution: { type: "text", filter: "text", search: true },
      position_title: { type: "text", filter: "text" },
      latest_declaration_year: { type: "int", sort: true, filter: "range" },
      has_declaration: { type: "bool", filter: "eq" },
      // >0 means this person's totals are INCOMPLETE — 090 could not total an implausible
      // declared row. The UI must caveat the figures rather than present them as whole.
      excluded_asset_rows: { type: "int", filter: "range" },
      total_assets_eur: { type: "number", sort: true, filter: "range" },
      total_debts_eur: { type: "number", sort: true, filter: "range" },
      net_worth_eur: { type: "number", sort: true, filter: "range" },
      real_estate_count: { type: "int", sort: true, filter: "range" },
      real_estate_unvalued: { type: "int", sort: true, filter: "range" },
      delta_previous_year: { type: "int" },
      delta_absolute_eur: { type: "number", sort: true, filter: "range" },
      delta_pct: { type: "number", sort: true, filter: "range" },
    },
    select: [
      "slug",
      "official_slug",
      "name",
      "category",
      "source",
      "is_exec",
      "is_muni",
      "institution",
      "position_title",
      "latest_declaration_year",
      "has_declaration",
      "excluded_asset_rows",
      "total_assets_eur",
      "total_debts_eur",
      "net_worth_eur",
      "real_estate_count",
      "real_estate_unvalued",
      "delta_previous_year",
      "delta_absolute_eur",
      "delta_pct",
    ],
    defaultSort: [["net_worth_eur", "desc"]],
    aggregates: [{ fn: "count" }],
    maxPageSize: 100,
  },

  // The global persons browser (/persons) — matview person_browse_table, migration 120.
  // Plan: docs/plans/persons-browser-v1.md. Generalizes `officials_rankings` (one facet,
  // ranked by wealth) to the whole 56.8k-person identity layer.
  //
  // ONE ROW PER PERSON. 120's header explains at length why the matview folds person_role
  // rather than joining it; the consequence HERE is that every multi-valued dimension is
  // filtered through a space-PADDED code set (`role_codes`, `facet_codes`, `party_codes`,
  // `oblast_codes`) with filter:"text", not through the scalar beside it. The scalars are
  // the representative seat, for DISPLAY. Filtering on `oblast_code` instead of
  // `oblast_codes` would drop 1,851 people from an oblast they genuinely serve — it reads
  // as "no such people", not as a narrowed view. The engine has no array containment
  // (eq/in/text/prefix/range only), so this is the shipped idiom; `ngos.signal_codes`
  // above does the same.
  //
  // ⚠ The padded sets must be matched as '% <code> %' with LIKE metacharacters ESCAPED —
  // `_` is a single-character wildcard and these values are full of it (`p_16`,
  // `SOFIA_CITY`, `chief_architect`). The client builds those values; the escaping lives
  // there (src/data/persons/useUrlPersonFilters.ts).
  //
  // NO `sum` AGGREGATE, and public_money_eur is the reason. Two co-officers of one company
  // each carry that company's FULL contract sum, so Σ down the table double-counts. A
  // total would be large, plausible and wrong. `count` only — asserted in db_table.test.js.
  persons: {
    base: "person_browse_table",
    scopeCols: [],
    columns: {
      // The stable paging identity: buildOrder uses `key` as the tiebreak when it exists
      // (else select[0]=slug). The name-fold private arm (120, S3) has NULL slug, so `key`
      // ('slug:<slug>' | 'fold:<name_fold>') is what keeps paging deterministic across both arms.
      key: { type: "text", filter: "in" },
      slug: { type: "text", filter: "in" },
      // P = public/resolved person, V = name-fold private owner (частен сектор). The ?sector
      // control filters this (public→P, private→V, all→P,V); defaultFilters below makes P the
      // floor so any caller that omits it still gets the public population.
      tier: { type: "text", filter: "in" },
      // position_type CODE (politician/executive/…/private_sector) — the ?position filter and the
      // mix-bar partition. sort:true/filter:"in" mirror primary_facet.
      position_type: { type: "text", sort: true, filter: "in" },
      identity_confidence: { type: "text", filter: "in" },
      // Search targets the TRANSLITERATED fold, so the term must be folded too:
      // searchCol WITHOUT searchFold matches a Cyrillic query against Latin text and
      // returns nothing, forever, while looking like a working query. Both flags or
      // neither. idx_person_browse_name_trgm backs it.
      name: {
        type: "text",
        sort: true,
        filter: "text",
        search: true,
        searchCol: "name_fold",
        searchFold: true,
      },
      photo_url: { type: "text" },
      namesake_risk: { type: "int" },
      // Single-valued and total — the "Тип лице" mix bar is a PARTITION, so it groups on
      // this, never on the boolean flags (which overlap by design: a person is routinely
      // both is_muni and is_company, and a bool facet returns {true,false}, not a
      // breakdown).
      primary_facet: { type: "text", sort: true, filter: "in" },
      primary_role: { type: "text", sort: true, filter: "in" },
      prominence: { type: "int", sort: true },
      // The padded code SETS — the filter targets for every multi-valued dimension. The
      // UI's group filter uses the boolean flags below instead (exact counts, and the only
      // way to reach the company/ngo/donor groups at all — see src/data/persons/
      // personGroups.ts); facet_codes stays filterable for a caller that wants the raw
      // facet vocabulary. Both are gin_trgm indexed, as the leading wildcard requires.
      role_codes: { type: "text", filter: "text" },
      facet_codes: { type: "text", filter: "text" },
      roles_n: { type: "int", sort: true, filter: "range" },
      sources_n: { type: "int", sort: true, filter: "range" },
      // Membership flags, in lockstep with officials_rankings_table — 503 people hold both
      // an executive and a municipal post, so no single representative column can answer
      // "is this an executive official?".
      is_exec: { type: "bool", filter: "eq" },
      is_muni: { type: "bool", filter: "eq" },
      is_mp: { type: "bool", filter: "eq" },
      is_magistrate: { type: "bool", filter: "eq" },
      is_ngo: { type: "bool", filter: "eq" },
      is_company: { type: "bool", filter: "eq" },
      is_candidate: { type: "bool", filter: "eq" },
      is_donor: { type: "bool", filter: "eq" },
      // Ever actually held a post (31,971 of 56,801). The complement is the candidate-only
      // long tail — people who stood and did not take office — which the browser can set
      // aside without pretending they are absent from the register.
      held_office: { type: "bool", filter: "eq" },
      party_primary: { type: "text", filter: "in" },
      // sort:true is the party-switcher view in one click (4,723 people carry 2+).
      parties_n: { type: "int", sort: true, filter: "range" },
      party_codes: { type: "text", filter: "text" },
      place_kind: { type: "text", filter: "in" },
      place_code: { type: "text", filter: "in" },
      place_label: { type: "text", sort: true },
      place_label_en: { type: "text" },
      // `facet: true`, NOT `filter` — deliberately. This column is the representative seat,
      // so it is the only place the oblast VOCABULARY lives (the padded set cannot be
      // GROUP BY'd), but filtering it would narrow every place filter to that one seat and
      // drop 1,851 people from an oblast they genuinely serve. The UI facets this and
      // filters `oblast_codes`. Same for judicial bodies below.
      oblast_code: { type: "text", facet: true },
      oblast_codes: { type: "text", filter: "text" },
      obshtina_code: { type: "text", filter: "in" },
      // filter:"in" (EXACT), not "text": the picker facets and filters this same column, so
      // an ILIKE '%…%' would make its counts wrong wherever one name contains another —
      // "Окръжен съд - Пловдив (59)" also matched "Административен съд - Пловдив" and
      // returned 358. `search: true` still gives the free-text box a substring arm over it,
      // which is where a partial name belongs.
      institution: { type: "text", filter: "in", search: true },
      judicial_kind: { type: "text", filter: "in" },
      judicial_tier: { type: "text", filter: "in" },
      latest_declaration_year: { type: "int", sort: true, filter: "range" },
      has_declaration: { type: "bool", filter: "eq" },
      net_worth_eur: { type: "number", sort: true, filter: "range" },
      // >0 means the totals are INCOMPLETE (090 could not total an implausible declared
      // row). The UI shows an asterisk and suppresses the delta rather than publishing a
      // fabricated collapse.
      excluded_asset_rows: { type: "int", filter: "range" },
      delta_pct: { type: "number", sort: true, filter: "range" },
      companies_n: { type: "int", sort: true, filter: "range" },
      // sort:true, NO agg — see the header.
      public_money_eur: { type: "number", sort: true, filter: "range" },
      tr_link_basis: { type: "text", filter: "in" },
    },
    select: [
      "key",
      "slug",
      "tier",
      "position_type",
      "identity_confidence",
      "name",
      "photo_url",
      "namesake_risk",
      "primary_role",
      "primary_facet",
      "prominence",
      "role_codes",
      "facet_codes",
      "roles_n",
      "sources_n",
      "is_exec",
      "is_muni",
      "is_mp",
      "is_magistrate",
      "is_ngo",
      "is_company",
      "is_candidate",
      "is_donor",
      "held_office",
      "party_primary",
      "parties_n",
      "party_codes",
      "place_kind",
      "place_code",
      "place_label",
      "place_label_en",
      "oblast_code",
      "obshtina_code",
      "institution",
      "judicial_kind",
      "judicial_tier",
      "latest_declaration_year",
      "has_declaration",
      "net_worth_eur",
      "excluded_asset_rows",
      "delta_pct",
      "companies_n",
      "public_money_eur",
      "tr_link_basis",
    ],
    // NOT net worth. Sorting the front page of every named person in Bulgaria by declared
    // wealth is an editorial statement; wealth stays an opt-in sort, as on /officials/assets.
    defaultSort: [
      ["prominence", "desc"],
      ["name", "asc"],
    ],
    // Public (tier P) is the floor: a caller that sends no `tier` filter (the pre-S3 client, a raw
    // API hit) gets the public population, never the 61.7k name-fold private owners by surprise.
    // The ?sector control overrides it (public→P, private→V, all→P,V).
    defaultFilters: [{ col: "tier", val: "P" }],
    aggregates: [{ fn: "count" }],
    // Avatar rows are visually heavy; the screen pages at 25.
    maxPageSize: 50,
  },

  // Per-obshtina municipal roster (matview municipal_officials_table, migration 102) —
  // replaces the by_obshtina/<code>.json shards and municipal/search_index.json.
  //
  // ONE ROW PER ROSTER LISTING, not per person: 46 people sit on more than one municipal
  // body, so person_slug is NOT unique here and official_slug is the key/tiebreak. Scope a
  // municipality page with obshtina; the cross-municipality name search the old
  // search_index.json served is the global `search` over name + municipality.
  municipal_officials: {
    base: "municipal_officials_table",
    scopeCols: ["obshtina"],
    columns: {
      official_slug: { type: "text", filter: "in" },
      person_slug: { type: "text", filter: "in" },
      name: { type: "text", sort: true, filter: "text", search: true },
      role: { type: "text", sort: true, filter: "in" },
      role_raw: { type: "text", filter: "text" },
      obshtina: { type: "text", filter: "in" },
      // 'Район <NAME>' for a district body folded under a city's obshtina, NULL for a
      // city-wide official. filter:"eq" so a caller can ask for the city-wide row
      // directly — /governance distinguishes Plovdiv's mayor from its six район mayors
      // on exactly this, and picking by sort order instead returns a район mayor.
      district: { type: "text", filter: "eq" },
      municipality: { type: "text", sort: true, filter: "text", search: true },
      latest_declaration_year: { type: "int", sort: true, filter: "range" },
      has_declaration: { type: "bool", filter: "eq" },
    },
    select: [
      "official_slug",
      "person_slug",
      "name",
      "role",
      "role_raw",
      "obshtina",
      "district",
      "municipality",
      "latest_declaration_year",
      "has_declaration",
      // candidateLink decoration (matview LEFT JOIN official_candidate_link, migration 108).
      // Display-only pass-through — never filtered/sorted/searched, so kept out of `columns`.
      // The frontend (useMunicipalOfficials) reassembles the OfficialCandidateLink from the
      // camelCased projection (candidate_party_name → candidatePartyName, …); every field is
      // NULL for a listing with no slate/MP match, in which case no link is emitted.
      "candidate_cycle",
      "candidate_party_name",
      "candidate_party_canonical_id",
      "candidate_list_pos",
      "candidate_pref_votes",
      "candidate_is_elected",
      "candidate_mp_id",
      "candidate_photo_url",
    ],
    defaultSort: [["name", "asc"]],
    aggregates: [{ fn: "count" }],
    maxPageSize: 200,
  },

  // MP wealth leaderboard (matview mp_assets_rankings_table, migration 105) — replaces
  // data/parliament/assets-rankings.json(+-top).
  //
  // FAN-OUT RESOURCE. Rows are emitted one per parliament the MP sat in, plus a literal
  // ns = 'all' bucket for the national list, because an MP belongs to several and the
  // engine scopes with a plain equality. `scope: { col: "ns", val: "52" }` is the current
  // parliament; omitting the scope falls back to `defaultScope` — the national list —
  // because the union of every bucket would count each MP once per parliament (2.0×
  // here) with the count aggregate and every facet inflated identically, and look
  // perfectly plausible. Never remove the defaultScope without removing the fan-out.
  //
  // THE FIGURES ARE NOT THE JSON'S, on purpose. They come from person_wealth_year, the
  // same series /person, /officials/assets and the wealth chart render, whereas
  // build_assets_rankings.ts also folded company shares (declaration table 10) into the
  // total. 154 of the ranked MPs declare such shares and read lower here. The migration
  // header explains why one number sitewide beat matching a file we are deleting.
  //
  // TWO YEAR COLUMNS, and they differ for 421 of the 767 ranked MPs:
  // latest_declaration_year is when the filing was LODGED (label it), period_year is
  // what it COVERS (join the wealth chart on it). Using one for the other shifts every
  // annual filing by a year.
  //
  // Three distinguishable "no figure" states — do not render them the same way:
  // person_slug NULL = not resolved to a public person; has_declaration false = nothing
  // on record; has_declaration true with a NULL net_worth_eur = filed, declared no
  // valued assets. The JSON could express none of these: it was built FROM declarations,
  // so a non-filer simply had no row, and only 767 of the 2,122 MPs appeared at all.
  mp_assets_rankings: {
    base: "mp_assets_rankings_table",
    scopeCols: ["ns"],
    defaultScope: { col: "ns", val: "all" },
    columns: {
      ns: { type: "text" },
      mp_id: { type: "int", filter: "in" },
      person_slug: { type: "text", filter: "in" },
      name: { type: "text", sort: true, filter: "text", search: true },
      party_group_short: { type: "text", sort: true, filter: "in" },
      is_current: { type: "bool", filter: "eq" },
      latest_declaration_year: { type: "int", sort: true, filter: "range" },
      latest_fiscal_year: { type: "int", filter: "range" },
      period_year: { type: "int", sort: true, filter: "range" },
      has_declaration: { type: "bool", filter: "eq" },
      total_assets_eur: { type: "number", sort: true, filter: "range" },
      total_debts_eur: { type: "number", sort: true, filter: "range" },
      net_worth_eur: { type: "number", sort: true, filter: "range" },
      real_estate_count: { type: "int", sort: true, filter: "range" },
      real_estate_unvalued: { type: "int", sort: true, filter: "range" },
      delta_previous_year: { type: "int" },
      delta_absolute_eur: { type: "number", sort: true, filter: "range" },
      delta_pct: { type: "number", sort: true, filter: "range" },
    },
    select: [
      "mp_id",
      "person_slug",
      "name",
      "party_group_short",
      "is_current",
      "latest_declaration_year",
      "latest_fiscal_year",
      "period_year",
      "has_declaration",
      "total_assets_eur",
      "total_debts_eur",
      "net_worth_eur",
      "real_estate_count",
      "real_estate_unvalued",
      "delta_previous_year",
      "delta_absolute_eur",
      "delta_pct",
    ],
    defaultSort: [["net_worth_eur", "desc"]],
    aggregates: [{ fn: "count" }],
    // 300 (was 100) so the AI mpAssetsByParty tool can pull every CURRENT MP of the
    // national list in one page (up to a full 240-seat parliament) to roll up per-party
    // averages server-side. The /mp-assets UI still pages 50 at a time. (persons-pg-retirement-v1 T2.5)
    maxPageSize: 300,
  },

  // MP declared vehicles (matview mp_cars_table, migration 105) — replaces
  // data/parliament/mp-cars.json. Same ns fan-out and the same defaultScope rule as
  // mp_assets_rankings above (3.2× inflation here if the default is ever removed).
  //
  // mp-cars.json itself has no byNs key — the per-parliament slice is a CLIENT-side
  // filter today (MpCarsScreen.tsx:49). Note that screen also falls back to the full
  // list when a parliament's slice is empty; the server has no equivalent, so a scoped
  // query on an empty bucket returns an empty table. Tier 2 decides whether to keep
  // that fallback in the client or drop it.
  //
  // ONE ROW PER DECLARED VEHICLE, not per MP: the /mp-cars table lists cars, and an MP
  // with five of them contributes five rows. The dashboard's "top makes" tile asks a
  // different question (how many MPs drive each make, so three VWs in one garage count
  // once) — that is a distinct-MP count over these rows, never `count`.
  //
  // `make` is NULL when the declared text matched no alias in build_car_makes.ts's brand
  // map. That is "unknown make", a real state the UI already labels; it is not a row to
  // filter out, and the builder reports those strings so the map can be extended.
  mp_cars: {
    base: "mp_cars_table",
    scopeCols: ["ns"],
    defaultScope: { col: "ns", val: "all" },
    columns: {
      ns: { type: "text" },
      car_id: { type: "int" },
      mp_id: { type: "int", filter: "in" },
      person_slug: { type: "text", filter: "in" },
      mp_name: { type: "text", sort: true, filter: "text", search: true },
      party_group_short: { type: "text", sort: true, filter: "in" },
      is_current: { type: "bool", filter: "eq" },
      make: { type: "text", sort: true, filter: "in" },
      detail: { type: "text", filter: "text", search: true },
      description: { type: "text", filter: "text" },
      acquired_year: { type: "int", sort: true, filter: "range" },
      value_eur: { type: "number", sort: true, filter: "range", agg: "sum" },
      amount: { type: "number" },
      currency: { type: "text", filter: "in" },
      is_spouse: { type: "bool", filter: "eq" },
      share: { type: "text" },
      merged_from_count: { type: "int" },
      declaration_year: { type: "int", sort: true, filter: "range" },
      source_url: { type: "text" },
    },
    select: [
      "car_id",
      "mp_id",
      "person_slug",
      "mp_name",
      "party_group_short",
      "is_current",
      "make",
      "detail",
      "description",
      "acquired_year",
      "value_eur",
      "amount",
      "currency",
      "is_spouse",
      "share",
      "merged_from_count",
      "declaration_year",
      "source_url",
    ],
    defaultSort: [["value_eur", "desc"]],
    // count(*) = total cars; count(value_eur) = cars with a declared value;
    // sum(value_eur) = combined value — the /mp-cars summary line.
    aggregates: [
      { fn: "count" },
      { fn: "count", col: "value_eur" },
      { fn: "sum", col: "value_eur" },
    ],
    maxPageSize: 200,
  },

  // КЗП product browser (migration 048). One row per CANONICAL product — the
  // cross-chain identity derived from names, because the feed carries no EAN.
  //
  // current_min_eur and pct_since_euro are materialized columns, refreshed by
  // `npm run prices:catalog`. They cannot be derived at query time: the registry
  // engine can only ORDER BY real base-table columns, and computing them per
  // request would join price_current across ~1.4M rows on every keystroke.
  //
  // Retired products (chain_count = 0) keep their frozen slug so indexed
  // /product/:slug URLs resolve, but must never appear in the browser. The UI
  // filters chain_count >= 1; there is no server-side default filter here.
  price_products: {
    base: "price_products",
    scopeCols: ["pid"],
    columns: {
      // product_id is the stable paging tiebreak (buildOrder appends select[0]).
      // pct_since_euro ties are extremely common (0.00 for every unchanged
      // product), so a unique id is what keeps paging deterministic.
      product_id: { type: "int" },
      slug: { type: "text" },
      // search:true is backed by price_products_trgm (gin, title gin_trgm_ops).
      title: { type: "text", sort: true, filter: "text", search: true },
      pid: { type: "int", sort: true, filter: "in" },
      brand: { type: "text", filter: "text" },
      net_qty: { type: "number", sort: true, filter: "range" },
      net_unit: { type: "text", filter: "in" },
      unit_priced: { type: "bool", filter: "eq" },
      chain_count: { type: "int", sort: true, filter: "range" },
      sku_count: { type: "int", sort: true, filter: "range" },
      // Gate the cross-chain ladder on this; a low-confidence group must not
      // present itself as a like-for-like comparison.
      confidence: { type: "int", sort: true, filter: "range" },
      current_min_eur: { type: "number", sort: true, filter: "range" },
      pct_since_euro: { type: "number", sort: true, filter: "range" },
    },
    select: [
      "product_id",
      "slug",
      "title",
      "pid",
      "brand",
      "net_qty",
      "net_unit",
      "unit_priced",
      "chain_count",
      "sku_count",
      "confidence",
      "current_min_eur",
      "pct_since_euro",
    ],
    defaultSort: [["chain_count", "desc"]],
    aggregates: [{ fn: "count" }],
    maxPageSize: 100,
  },
  // Local-tier procurement per settlement, for /procurement/by-settlement.
  //
  // SCOPED, not global: procurement_settlement_rank (119) holds one row per settlement PER
  // pscope window, so this resource FANS OUT — an unscoped query returns the union of ~30
  // windows (10,207 rows, €147bn, each settlement counted once per window) with HTTP 200
  // and no error. `defaultScope` is what makes that impossible; do not remove it. The key
  // the client sends comes from useScopeWindow().scopeKey — the same shared definition the
  // precompute itself was built from.
  //
  // Replaces a 196 KB blob the page paginated, sorted and searched in the browser.
  procurement_settlements: {
    base: "procurement_settlement_rank",
    scopeCols: ["scope_key"],
    defaultScope: { col: "scope_key", val: "all" },
    columns: {
      // Declared because it is the scope column — the engine requires every
      // client-addressable column to be in the registry. Not projected: the caller already
      // knows which scope it asked for, and echoing it on all 868 rows is pure weight.
      scope_key: { type: "text" },
      ekatte: { type: "text" },
      // Sorted by the BULGARIAN name in both languages: the ranking is one row per place,
      // and re-ordering it by the English transliteration would shuffle the table for an
      // English reader without telling them why. name_en is projected, not sorted on.
      name: { type: "text", sort: true },
      name_en: { type: "text" },
      province: { type: "text", sort: true, filter: "in" },
      obshtina: { type: "text" },
      // Global search hits the transliterated fold (gin_trgm-indexed), so Latin
      // "veliko tarnovo" matches "Велико Търново" — the server-side replacement for the
      // in-memory latinSkeleton filter this page used to run. The raw columns have no
      // trigram index, so a raw ILIKE would seq-scan every scope's rows.
      name_fold: {
        type: "text",
        search: true,
        searchCol: "name_fold",
        searchFold: true,
      },
      // agg on total_eur backs BOTH the sum (the footer total) and the max (the in-cell
      // magnitude bar's denominator — the largest value in the current filtered set).
      total_eur: { type: "number", sort: true, filter: "range", agg: "sum" },
      contract_count: {
        type: "number",
        sort: true,
        filter: "range",
        agg: "sum",
      },
      awarder_count: {
        type: "number",
        sort: true,
        filter: "range",
        agg: "sum",
      },
    },
    select: [
      "ekatte",
      "name",
      "name_en",
      "province",
      "obshtina",
      "total_eur",
      "contract_count",
      "awarder_count",
    ],
    // ekatte is the tiebreak, not decoration: total_eur alone is not a total order (many
    // settlements share a value), and without it equal rows swap between pages mid-scroll.
    defaultSort: [
      ["total_eur", "desc"],
      ["ekatte", "asc"],
    ],
    aggregates: [
      { fn: "count" },
      { fn: "sum", col: "total_eur" },
      { fn: "max", col: "total_eur" },
    ],
    // An EXPORT CEILING, not a browsing page size: the widest scope holds 868 settlements,
    // so "Download CSV" fetches the whole filtered set in one request instead of walking
    // offsets. Higher than every other resource (100) deliberately — a full page is ~145 kB,
    // still smaller than the 196 KB blob this replaces, and MAX_OFFSET still caps paging.
    maxPageSize: 1000,
  },

  // The per-scope contractor leaderboard behind /procurement/contractors (122).
  // Fan-out matview keyed by scope_key, mirroring procurement_settlements above.
  // CPV is a rollup DIMENSION, not an array: each contractor has per-division rows
  // plus an 'ALL' rollup row, and the screen ALWAYS sends division (default 'ALL',
  // since defaultScope covers only the ONE scope column). The engine has no array
  // support, so this is the only shape that expresses "top contractors in sector X".
  contractor_rankings: {
    base: "contractor_rank",
    scopeCols: ["scope_key"],
    defaultScope: { col: "scope_key", val: "all" },
    columns: {
      // The scope column — declared (the engine requires every client-addressable
      // column registered) but not projected: the caller knows its own scope.
      scope_key: { type: "text" },
      // eik is the paging tiebreak (select[0]) AND deep-link filterable. It is a total
      // order within the always-filtered (scope_key, division) partition — same role
      // ekatte plays for procurement_settlements. sort:true so the ["eik","asc"] tail of
      // defaultSort is genuinely honored (index-served by the UNIQUE key) rather than
      // relying implicitly on eik staying select[0].
      eik: { type: "text", sort: true, filter: "eq" },
      // The CPV-division rollup filter. Always sent by the screen ('ALL' by default,
      // a 2-digit division when the CPV picker is set). filter:"eq" is single-valued
      // by design — a multi-value set would return N rows per contractor and
      // double-count the leaderboard.
      division: { type: "text", filter: "eq" },
      // Global search hits the transliterated fold (gin_trgm-indexed) so Latin
      // "sofarma" matches "СОФАРМА"; the raw name column has no trigram index.
      name: {
        type: "text",
        sort: true,
        search: true,
        searchCol: "name_fold",
        searchFold: true,
      },
      // agg on total_eur backs both the footer sum and the in-cell magnitude bar's max.
      total_eur: { type: "number", sort: true, filter: "range", agg: "sum" },
      contract_count: { type: "number", sort: true, filter: "range" },
      award_count: { type: "number" },
      is_mp_tied: { type: "bool", filter: "eq" },
      // Display-only native-currency remainder (jsonb). Never sorted/filtered/faceted,
      // so the type label is cosmetic — the projection passes the object through as-is.
      total_other: { type: "text" },
    },
    select: [
      "eik",
      "name",
      "total_eur",
      "contract_count",
      "is_mp_tied",
      "total_other",
    ],
    // eik is the tiebreak, not decoration: total_eur alone is not a total order, and
    // every composite sort index (122) trails with eik so the default sort stays
    // index-served.
    defaultSort: [
      ["total_eur", "desc"],
      ["eik", "asc"],
    ],
    aggregates: [
      { fn: "count" },
      { fn: "sum", col: "total_eur" },
      { fn: "max", col: "total_eur" },
    ],
    // The SECOND fan-out margin, defaulted server-side: the screen sends `division`
    // ('ALL' or a 2-digit code), but /api/db/table is a general endpoint — a deep link
    // or AI-tool path that omits it would otherwise union the 'ALL' rollup with every
    // per-division row and double-count. buildWhere applies this when division is absent.
    defaultFilters: [{ col: "division", val: "ALL" }],
    // Export ceiling, like procurement_settlements — the widest (scope,division) slice
    // is the 'all'/'ALL' leaderboard (~29.5k rows); MAX_OFFSET still caps deep paging.
    maxPageSize: 1000,
  },
};

const MAX_OFFSET = 100000; // deep-paging guard (use search/filters instead)
const MAX_IN_VALUES = 1000; // cap on `in`-filter array length (bind-param guard)
const clampInt = (v, def, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), lo), hi) : def;
};

// Build a WHERE predicate for one column filter. Returns { sql, params } whose
// $-placeholders continue from `p0` (1-indexed). Throws on non-whitelisted shape.
const buildFilter = (col, def, f, p0) => {
  const params = [];
  // push a value + return its placeholder (numbered absolutely from p0).
  const push = (v) => {
    params.push(v);
    return `$${p0 + params.length}`;
  };
  const t = def.filter;
  if (t === "eq") return { sql: `${col} = ${push(f.value)}`, params };
  // NULL-safe inequality — `col != x` drops NULL rows, which is wrong when NULL is the
  // common case: excluding €0 consortium-MEMBER rows (consortium_role IS DISTINCT FROM
  // 'member') must KEEP the ~99% of contracts whose consortium_role is NULL. Used by the
  // person contracts browser to match person_procurement's count basis (024:47-48).
  if (t === "isdistinct") {
    // Empty value → no predicate (drop the filter), like prefix/semijoin. The mode exists
    // for NULL correctness, so a stray `IS DISTINCT FROM NULL` (which would drop every NULL
    // row — the opposite of the intent) must never be emitted.
    if (f.value == null || f.value === "") return null;
    return { sql: `${col} IS DISTINCT FROM ${push(f.value)}`, params };
  }
  if (t === "in") {
    // Cap the array so a pathological client can't blow past Postgres's 65,535
    // bind-parameter limit (or seq-scan a giant IN) and 500 the route.
    const raw = Array.isArray(f.value) ? f.value : [f.value];
    const arr = raw.slice(0, MAX_IN_VALUES);
    if (arr.length === 0) return null;
    // Expand to individual params (col IN ($a,$b,…)) so PG infers each value's
    // type from the column — avoids "could not determine data type" on ANY().
    return { sql: `${col} IN (${arr.map((v) => push(v)).join(", ")})`, params };
  }
  if (t === "prefix") {
    // Array value → OR of prefixes (e.g. a sector category that spans several CPV
    // divisions: cpv LIKE '72%' OR '48%' OR '32%' OR '30%'). Scalar → one prefix.
    const arr = Array.isArray(f.value) ? f.value : [f.value];
    const clauses = arr
      .filter((v) => v != null && v !== "")
      .map((v) => `${col} LIKE ${push(`${String(v)}%`)}`);
    if (clauses.length === 0) return null;
    return {
      sql: clauses.length > 1 ? `(${clauses.join(" OR ")})` : clauses[0],
      params,
    };
  }
  if (t === "semijoin") {
    // A VIRTUAL filter column: it names no column of the base table. The registry
    // supplies both the real column to constrain (`semiJoinCol`) and a subquery
    // template (`semiJoinSql`) carrying exactly one `?` placeholder, and the
    // client's value is bound into it as an ordinary parameter.
    //
    // WHY a template rather than the equivalent `in` filter with the ids resolved
    // client-side: contracts has no place column, so scoping to a settlement means
    // "every buyer seated there". Resolving that set in the browser costs a
    // round-trip AND put 327 EIKs (a 6,199-char URL) on the query string for София.
    // The semi-join hands the whole question to the planner, which turns it into an
    // index-only probe. See docs/plans/procurement-settlement-browser-v1.md §2.1.
    //
    // SECURITY: `semiJoinSql` and `semiJoinCol` come from the REGISTRY, never from
    // the request — the client sends only the bound value, exactly as for every
    // other filter mode. Nothing here interpolates client input into SQL.
    //
    // FAILS CLOSED, unlike every other mode. Elsewhere a filter whose value went
    // missing just widens the result — it is a refinement, and dropping it is safe.
    // A semijoin is the page's IDENTITY scope: dropped, the request answers with the
    // entire national corpus, at a 200, with an exact count, under one settlement's
    // heading. `required` says which kind this is; an absent value is a caller bug,
    // so it throws rather than silently serving ~3M rows.
    if (f.value == null || f.value === "") {
      if (def.required)
        throw new DbRequestError(`${col}: required filter received no value`);
      return null;
    }
    // An array/object would be bound as a PG array literal ('{68134,56784}'), match
    // nothing, and render "0 contracts" for a real settlement. Refuse it: a scope
    // filter degrading to a silent empty set is worse than a loud error.
    if (typeof f.value === "object")
      throw new DbRequestError(`semijoin ${col}: expects a scalar value`);
    // REGISTRY blame, not caller blame — a 500, deliberately. See DbRequestError.
    const parts = String(def.semiJoinSql).split("?");
    if (parts.length !== 2)
      throw new Error(
        `semijoin ${col}: template needs exactly one placeholder`,
      );
    return {
      sql: `${def.semiJoinCol} IN (${parts[0]}${push(f.value)}${parts[1]})`,
      params,
    };
  }
  if (t === "text")
    return { sql: `${col} ILIKE ${push(`%${String(f.value)}%`)}`, params };
  if (t === "range") {
    const parts = [];
    if (f.min != null && f.min !== "") parts.push(`${col} >= ${push(f.min)}`);
    if (f.max != null && f.max !== "") parts.push(`${col} <= ${push(f.max)}`);
    return parts.length ? { sql: parts.join(" AND "), params } : null;
  }
  // Unreachable from a request: buildWhere already rejected a column with no
  // `filter`, so getting here means the registry declared a filter MODE this
  // switch does not implement. Registry blame — stays a 500.
  throw new Error(`column ${col} is not filterable`);
};

// Turn a validated request into { whereSql, params }. Scope + column filters +
// global search, all parameterized, all whitelisted.
//
// `opts.skipDefaultFilterCols` (a Set) suppresses `defaultFilters` for those columns.
// The facet path uses it: a facet ENUMERATES a dimension's values, which is
// fundamentally incompatible with defaulting that same dimension to one value — a
// `division` facet under `defaultFilters:[{division:'ALL'}]` would otherwise return
// only the 'ALL' bucket. Defaults for OTHER columns still apply, so a facet on a
// non-defaulted column stays double-count-safe.
const buildWhere = (r, req, opts = {}) => {
  const where = [];
  const params = [];
  const add = (built) => {
    if (!built) return false;
    where.push(`(${built.sql})`);
    params.push(...built.params);
    return true;
  };

  // A resource may declare a `defaultScope` applied when the caller sends none. Only
  // FAN-OUT resources need it — those whose base emits one row per (entity, scope value)
  // plus an aggregate bucket, where the union of every bucket is not a bigger answer but
  // a WRONG one: each entity counted once per bucket it belongs to, with the `count`
  // aggregate and every facet inflated to match, and no error anywhere. mp_assets_rankings
  // (2.0×) and mp_cars (3.2×) are those; the other resources are one-row-per-entity and
  // an absent scope legitimately means "all of them". Validated in db_table.test.js.
  const scope = req.scope && req.scope.col ? req.scope : r.defaultScope;
  if (scope && scope.col) {
    if (!r.scopeCols.includes(scope.col))
      throw new DbRequestError(`bad scope column: ${scope.col}`);
    params.push(scope.val);
    where.push(`${scope.col} = $${params.length}`);
  }

  // `for…of` over a non-array (an object, a string) throws a TypeError, which is
  // the same caller mistake as a bad column id but would reach the route as an
  // opaque 500. Name it instead.
  const reqCols = req.filters?.columns ?? [];
  if (!Array.isArray(reqCols))
    throw new DbRequestError("filters.columns must be an array");

  // Track which columns actually PRODUCED a predicate, not merely which were SENT. A filter that
  // built nothing (an empty `in` array, an empty text term) must NOT suppress a defaultFilter
  // below — otherwise `tier:[]` would silently defeat the persons public floor, and `division:[]`
  // would un-guard the contractor_rankings rollup double-count. Presence ≠ effect.
  const effectiveIds = new Set();
  for (const f of reqCols) {
    const def = r.columns[f.id];
    if (!def || !def.filter)
      throw new DbRequestError(`column not filterable: ${f.id}`);
    // A def may map a logical filter id to a different PHYSICAL column via `col`
    // (registry-sourced, whitelisted — never user input), so one physical column
    // can back two filter modes (e.g. tenders.cpv as exact `in` for topics AND
    // cpv_prefix as `prefix` for the normalcy "browse similar" deep link).
    if (add(buildFilter(def.col || f.id, def, f, params.length)))
      effectiveIds.add(f.id);
  }

  // A SECOND fan-out margin, defaulted like `defaultScope` above. `defaultScope`
  // guards only ONE column, but a resource can fan out on two — contractor_rankings
  // is (scope_key × division), each with a rollup bucket ('all' / 'ALL'). If a
  // caller omits `division`, `scope_key = 'all'` alone unions the 'ALL' rollup row
  // with every per-division row per contractor → a ~2× double-counted leaderboard,
  // served 200 with nothing to flag it. So for any declared defaultFilter whose
  // column the caller did NOT filter, apply `col = val`. Same double-count rationale
  // as defaultScope, for the second dimension. Validated in db_table.test.js.
  const skipDefaults = opts.skipDefaultFilterCols;
  for (const df of r.defaultFilters ?? []) {
    if (effectiveIds.has(df.col)) continue;
    if (skipDefaults && skipDefaults.has(df.col)) continue;
    const def = r.columns[df.col];
    // Registry blame — a resource declaring a default on a column it does not
    // expose. Stays a 500: no request can avoid it.
    if (!def || !def.filter)
      throw new Error(`bad defaultFilter col: ${df.col}`);
    add(buildFilter(df.col, def, { value: df.val }, params.length));
  }

  // Global search ORs every `search:true` column. A caller may narrow that to a
  // specific subset via `filters.globalCols` (a whitelist of logical column ids)
  // — e.g. the project-file seed searches contract TITLE only, so a free-text
  // term ("хемус") is not also matched against contractor_name and does not pull
  // in unrelated procedures won by a consortium merely NAMED after the landmark
  // (a "…Хемус…" firm building a different road). Every id must be a real
  // searchable column: a typo would silently drop the whole search arm and match
  // the entire corpus, so reject it like a bad filter. Validated up front — even
  // with no active `global` term — so a malformed request always throws rather
  // than being silently accepted in the empty-term case.
  const searchAll = Object.entries(r.columns).filter(([, d]) => d.search);
  const globalCols = req.filters?.globalCols;
  let restrictedDefs = null;
  if (Array.isArray(globalCols) && globalCols.length) {
    const searchable = new Set(searchAll.map(([id]) => id));
    for (const id of globalCols)
      if (!searchable.has(id))
        throw new DbRequestError(`column not searchable: ${id}`);
    const allow = new Set(globalCols);
    restrictedDefs = searchAll.filter(([id]) => allow.has(id));
  }

  const g = (req.filters?.global ?? "").trim();
  if (g) {
    // Each searchable column ORs one ILIKE. A column may redirect the match to a
    // physical `searchCol` and/or fold it: `searchFold` searches the transliter-
    // ated column via translit_bg_latin($term) so the gin_trgm index on that fold
    // is usable (tenders' buyer_fold/subject_fold — the raw columns have no
    // trigram index, so a raw ILIKE '%q%' seq-scans the whole corpus). Columns
    // without these flags keep the plain raw-column ILIKE, so other resources
    // (contracts, whose raw columns ARE trigram-indexed) are unchanged. The raw
    // `%g%` and the folded `g` are each pushed at most once and shared across the
    // OR arms.
    const searchDefs = restrictedDefs ?? searchAll;
    // Opt-in: drop the trigram `%>` fallback from the free-text match, leaving
    // only the prefix-AND FTS arm. The project-file seed sets this (its
    // membership is decided by a downstream confidence gate, so the fuzzy arm
    // only pollutes the amount-sorted seed window with unrelated near-spellings
    // and inflates the exact count banner). Default keeps FTS+trigram.
    const ftsOnly = req.filters?.globalFtsOnly === true;
    if (searchDefs.length) {
      const ors = [];
      let rawIdx = null; // "%g%" for the plain contiguous-substring arms
      let gIdx = null; // raw g, shared by the fold + FTS arms
      const rawParam = () => {
        if (rawIdx == null) {
          params.push(`%${g}%`);
          rawIdx = params.length;
        }
        return rawIdx;
      };
      const gParam = () => {
        if (gIdx == null) {
          params.push(g);
          gIdx = params.length;
        }
        return gIdx;
      };
      for (const [id, d] of searchDefs) {
        const target = d.searchCol || id;
        if (d.searchText) {
          // Long free-text field (contract title / tender subject). Match it the
          // way the combined-search dropdown does: prefix-AND FTS over the
          // Cyrillic→Latin fold, OR a trigram word-similarity fallback for
          // mid-word / near-spelling hits (e.g. the article's "Югозападна" vs the
          // corpus's "Западна дъга"). Keeps the "see all" table consistent with
          // the dropdown instead of a raw contiguous substring, which returned
          // nothing for any multi-word or punctuated query. Both passes ride the
          // fold's gin indexes (to_tsvector FTS + gin_trgm); `%>` uses the default
          // pg_trgm.word_similarity_threshold (0.6), same as the dropdown.
          const i = gParam();
          ors.push(
            ftsOnly
              ? `to_tsvector('simple', ${target}) @@ fold_prefix_tsquery($${i})`
              : `(to_tsvector('simple', ${target}) @@ fold_prefix_tsquery($${i})` +
                  ` OR ${target} %> translit_bg_latin($${i}))`,
          );
        } else if (d.searchFold) {
          // Transliterated contiguous substring — entity-name columns whose fold
          // is gin_trgm-indexed (buyer_fold). ILIKE '%q%' stays simple + precise
          // for names.
          ors.push(
            `${target} ILIKE '%' || translit_bg_latin($${gParam()}) || '%'`,
          );
        } else {
          // Plain raw-column contiguous substring (trigram-indexed raw columns).
          ors.push(`${target} ILIKE $${rawParam()}`);
        }
      }
      where.push(`(${ors.join(" OR ")})`);
    }
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
    filtered: where.length > 0,
  };
};

const buildOrder = (r, req) => {
  const sort =
    Array.isArray(req.sort) && req.sort.length ? req.sort : r.defaultSort;
  const terms = [];
  for (const s of sort) {
    const [id, dir] = Array.isArray(s) ? s : [s.id, s.desc ? "desc" : "asc"];
    const def = r.columns[id];
    if (!def || !def.sort) continue;
    terms.push(`${id} ${dir === "desc" ? "DESC NULLS LAST" : "ASC"}`);
  }
  // Stable tiebreaker on the key/first select col so paging is deterministic.
  const tie = r.columns.key ? "key" : r.select[0];
  terms.push(`${tie} ASC`);
  return `ORDER BY ${terms.join(", ")}`;
};

// The relation to run the count/sum aggregate + facet GROUP BYs over. Prefer the
// cheap base table (`r.aggBase`) so the covering indexes (migration 113) serve
// them as INDEX-ONLY scans; the *_list VIEW's LEFT JOINs (appeal flags, risk
// cache) defeat index-only scans even when the joins are semantically eliminable
// (MEASURED: all-years contracts count+sum stayed a 940 MB seq scan through the
// view, 40 MB index-only against the base). Fall back to the view the instant the
// request references a viewOnly column — a WHERE filter, the scope, or (facets) the
// faceted dimension itself — since that column does not exist on the base table.
// `whereIds`/`facetIds` are registry-sourced column ids (never raw SQL).
const touchesViewOnly = (r, ids) =>
  ids.some((id) => id && r.columns[id]?.viewOnly);
// A filter mode that names no real column of the base table, so it can be a WHERE
// predicate but never a GROUP BY target or a projection.
const isVirtualCol = (d) => d?.filter === "semijoin";

// The column id a filter PHYSICALLY constrains. A semijoin's logical id is virtual —
// the SQL it emits touches `semiJoinCol` — so anything reasoning about which relation
// the query needs (viewOnly → aggBase) must resolve through here, or it will decide
// using a descriptor that describes nothing. Other modes may redirect via `col`.
const physicalColId = (r, id) => {
  const d = r.columns?.[id];
  if (!d) return id;
  return d.semiJoinCol ?? d.col ?? id;
};

const aggBaseFor = (r, whereIds, facetIds = []) =>
  r.aggBase && !touchesViewOnly(r, whereIds) && !touchesViewOnly(r, facetIds)
    ? r.aggBase
    : r.base;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const buildAggSelect = (r) => {
  const sel = ["count(*)::bigint AS _count"];
  for (const a of r.aggregates ?? []) {
    // Bare `count` is the always-present count(*) above; a column-scoped `count`
    // is a NON-NULL count (e.g. "how many rows carry a declared value").
    if (a.fn === "count" && !a.col) continue;
    if (!a.col || !r.columns[a.col]) continue; // col is registry-sourced (safe)
    const camel = cap(snakeToCamel(a.col));
    if (a.fn === "count")
      sel.push(`count(${a.col})::bigint AS "count${camel}"`);
    else if (a.fn === "sum" && r.columns[a.col]?.agg === "sum")
      sel.push(`coalesce(sum(${a.col}),0) AS "sum${camel}"`);
    else if (a.fn === "avg")
      sel.push(`avg(${a.col})::double precision AS "avg${camel}"`);
    // `max` shares sum's `agg === "sum"` gate — that marker means "this numeric column is
    // safe to aggregate". Gated on the exact value, not on `agg` being truthy: a looser
    // check would admit a text or date column whose max the client then reads through
    // Number() as NaN. coalesce for the same reason sum has it — an empty filtered set
    // must yield 0, not null, since the client divides by this to size a magnitude bar.
    else if (a.fn === "max" && r.columns[a.col]?.agg === "sum")
      sel.push(`coalesce(max(${a.col}),0) AS "max${camel}"`);
  }
  return sel.join(", ");
};

/**
 * Run one server-side table request. `q(sql, params) => Promise<rows>` is the
 * caller's query fn (dev pool or Cloud SQL pool). If `q.tx(cb)` is exposed, the
 * page-of-rows query and the count/aggregate query run inside it as ONE READ
 * ONLY transaction — a single MVCC snapshot — so a concurrent ingest COMMIT can
 * never make them reflect different corpora (paginated rows from the pre-ingest
 * table, totals from the post-ingest table). Callers without `q.tx` fall back to
 * two autocommit round-trips (only observably inconsistent mid-ingest). Returns
 * { rows, total, totalExact, page, pageSize, aggregates }.
 */
const runDbTable = async (q, reqRaw) => {
  const req = reqRaw || {};
  const r = REGISTRY[req.resource];
  if (!r) throw new DbRequestError(`unknown resource: ${req.resource}`);

  const { whereSql, params, filtered } = buildWhere(r, req);
  const scoped = !!(req.scope && req.scope.col);
  const orderSql = buildOrder(r, req);
  const pageSize = clampInt(req.pageSize, 25, 1, r.maxPageSize);
  const page = clampInt(req.page, 0, 0, Math.floor(MAX_OFFSET / pageSize));
  const offset = page * pageSize;

  const projection = r.select
    .map((c) => `${c} AS "${snakeToCamel(c)}"`)
    .join(", ");

  // Exact count + aggregates when the set is bounded (scoped or filtered) OR
  // aggregates are wanted anyway; else a cheap reltuples estimate.
  const wantAgg = (r.aggregates ?? []).length > 0;
  const exact = scoped || filtered || wantAgg;

  // Pin both queries to one snapshot when the caller supports it (see docstring).
  const run = typeof q.tx === "function" ? q.tx : (cb) => cb(q);

  // Optimization fence for free-text search. With a global search AND an
  // ORDER BY on an indexed column + LIMIT, the planner otherwise walks the
  // ordered index (e.g. idx_tenders_value) applying the search ILIKE — which it
  // can't estimate through a parameterized/opaque pattern — as a row filter,
  // scanning deep for selective terms (MEASURED: 34s / statement_timeout in the
  // cross-region Cloud Run function, though fast with a constant-folded literal
  // locally). Wrapping the filtered set in `(… OFFSET 0)` forces the trigram/
  // text filter to run first (bitmap index scan → all matches), then the outer
  // sort+limit. Only for search: a plain filtered/scoped page keeps its optimal
  // direct index walk (the fence would needlessly materialize the whole set).
  const hasGlobal = !!(req.filters?.global ?? "").trim();
  const pageSql = hasGlobal
    ? `SELECT ${projection} FROM (SELECT * FROM ${r.base} ${whereSql} OFFSET 0) s ${orderSql} LIMIT ${pageSize} OFFSET ${offset}`
    : `SELECT ${projection} FROM ${r.base} ${whereSql} ${orderSql} LIMIT ${pageSize} OFFSET ${offset}`;

  return run(async (qq) => {
    const rows = await qq(pageSql, params);

    let total;
    let totalExact;
    let aggregates = {};
    if (exact) {
      // Aggregate over the base table when the WHERE touches only base columns —
      // the covering indexes make it index-only. buildWhere referenced the same
      // columns, so the identical whereSql/params are valid against aggBase.
      const whereIds = [
        req.scope?.col,
        ...(req.filters?.columns ?? []).map((f) => physicalColId(r, f.id)),
      ];
      const [a] = await qq(
        `SELECT ${buildAggSelect(r)} FROM ${aggBaseFor(r, whereIds)} ${whereSql}`,
        params,
      );
      total = Number(a._count);
      totalExact = true;
      // node-pg hands bigint/numeric back as STRINGS (sum, count(col)); coerce every
      // aggregate to a real number so DbTableResponse.aggregates: Record<string, number> is
      // honest and a consumer can't `sumA + sumB` into string concatenation. Magnitudes here
      // (counts, euro sums) are well inside 2^53.
      aggregates = Object.fromEntries(
        Object.entries(a)
          .filter(([k]) => k !== "_count")
          .map(([k, v]) => [k, Number(v)]),
      );
      aggregates.count = total;
    } else {
      const [e] = await qq(
        `SELECT reltuples::bigint AS est FROM pg_class WHERE oid = $1::regclass`,
        [r.base],
      );
      total = Math.max(0, Number(e?.est ?? 0));
      totalExact = false;
    }

    return { rows, total, totalExact, page, pageSize, aggregates };
  });
};

/**
 * Distinct values (+ counts) for facet dropdowns, over the resource's scope +
 * fixed filters only (so options are stable regardless of the user's other
 * selections). `req.columns` must be whitelisted + filterable. Returns
 * { facets: { col: [{ value, count }] } }.
 */
const runDbFacets = async (q, reqRaw) => {
  const req = reqRaw || {};
  const r = REGISTRY[req.resource];
  if (!r) throw new DbRequestError(`unknown resource: ${req.resource}`);

  // `filters` are the caller's ACTIVE facet filters (year / CPV / method / …),
  // merged with the non-editable `fixedFilters` (e.g. tag=contract). Passing them
  // makes each facet reflect the current selection — a "filter-scoped" facet. To
  // keep every option visible, the caller EXCLUDES a facet's own dimension from
  // its filter set (e.g. the procurement_method facet omits the method filter),
  // so selecting one bucket doesn't collapse the mix to that bucket alone.
  // Shape first: spreading or `.filter`-ing a non-array throws a TypeError, which
  // is the same caller mistake as a bad column id but reaches the route as an
  // opaque 500. Same rule as buildWhere's `filters.columns` guard.
  for (const k of ["columns", "fixedFilters", "filters"])
    if (req[k] != null && !Array.isArray(req[k]))
      throw new DbRequestError(`${k} must be an array`);

  const facetFilters = [...(req.fixedFilters ?? []), ...(req.filters ?? [])];
  const limit = clampInt(req.limit, 100, 1, 500);
  // A column may be faceted because it is FILTERABLE (the common case — the dropdown and
  // the filter are the same column) or because it explicitly opts in with `facet: true`.
  // The second exists for a column that supplies a VOCABULARY but must not be a filter
  // target: persons.oblast_code is the representative seat, so filtering it would drop
  // people from an oblast they genuinely serve, but it is still the only place the list of
  // oblasts lives. Facets are read-only aggregates, so opting one in adds no filter surface.
  //
  // A VIRTUAL filter (isVirtualCol) is the one filterable kind that is NOT facetable:
  // it has no expression of its own, so GROUP BY-ing it would emit an undefined-column
  // 42703 rather than a vocabulary. Excluded here rather than left to fail in Postgres,
  // since a facet request naming one is a caller bug.
  const cols = (req.columns ?? []).filter((c) => {
    const d = r.columns[c];
    return (d?.filter && !isVirtualCol(d)) || d?.facet;
  });

  // Column ids the shared WHERE touches (scope + fixed + active filters) — used
  // per-facet to decide whether it can aggregate over the base table.
  const whereIds = [
    req.scope?.col,
    ...(req.fixedFilters ?? []).map((f) => physicalColId(r, f.id)),
    ...(req.filters ?? []).map((f) => physicalColId(r, f.id)),
  ];

  // Each facet is an independent query — run them concurrently rather than
  // awaiting one column at a time.
  const facets = {};
  await Promise.all(
    cols.map(async (c) => {
      const expr = r.columns[c].facetExpr || c; // registry-sourced, safe
      // The WHERE is built PER-FACET, suppressing ONLY this column's defaultFilter —
      // a facet enumerates its own column's values, so defaulting it (e.g. division to
      // 'ALL') would collapse the facet to one bucket. Every OTHER column's default
      // still applies, so co-requesting a facet on a non-defaulted column stays
      // double-count-safe (it keeps the division='ALL' pin). Per-facet rather than one
      // shared WHERE precisely because a shared skip-set would drop the default for all
      // facets in the request. Cheap — these queries already run concurrently.
      const { whereSql, params } = buildWhere(
        r,
        { scope: req.scope, filters: { columns: facetFilters } },
        { skipDefaultFilterCols: new Set([c]) },
      );
      // `<> ''` is an empty-STRING guard; on non-text columns comparing to ''
      // errors (bool: "invalid input syntax for type boolean", int/number:
      // "...for type integer/numeric"), so drop it for any non-text facet.
      const ftype = r.columns[c].type;
      const guard =
        ftype === "bool" || ftype === "int" || ftype === "number"
          ? `${expr} IS NOT NULL`
          : `${expr} IS NOT NULL AND ${expr} <> ''`;
      const where = whereSql ? `${whereSql} AND (${guard})` : `WHERE ${guard}`;
      // Base table when neither the WHERE nor this facet's own dimension is
      // viewOnly — makes the GROUP BY an index-only scan (migration 113).
      const rel = aggBaseFor(r, whereIds, [c]);
      facets[c] = await q(
        `SELECT ${expr} AS value, count(*)::int AS count FROM ${rel} ${where} GROUP BY ${expr} ORDER BY count DESC LIMIT ${limit}`,
        params,
      );
    }),
  );
  return { facets };
};

module.exports = {
  runDbTable,
  runDbFacets,
  REGISTRY,
  buildWhere,
  buildAggSelect,
  DbRequestError,
};
