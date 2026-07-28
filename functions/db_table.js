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

// ---- resource registry -------------------------------------------------------
// Per dataset: base table, allowed scope columns, and a column whitelist. Each
// column flags what the client may do with it: sort, filter (+ how), search
// (global text), agg. `type` picks the filter/predicate shape.
const REGISTRY = {
  contracts: {
    // contracts_list = contracts + a per-row КЗК-appeal flag via the appealed-
    // ocids matview (migration 042); a view over the base, filters/sorts intact.
    // ⚠ Hard dep on migration 042 (no base-table fallback here — the projection
    // selects has_appeal/appeal_upheld): apply 042 to Cloud SQL BEFORE functions:db,
    // else 42P01. `db:load:tenders:pg:cloud` applies it; so does apply_functions.ts.
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
      awarder_name: { type: "text", sort: true, filter: "text", search: true },
      // filter:"in" (not "eq") — mirrors awarder_eik: the project-file resolver
      // scopes a CONTRACTOR-anchored thread by passing a contractor-EIK set
      // (contractor_eik IN (...)); the builder wraps a scalar in an array, so
      // single-value callers are unaffected.
      contractor_eik: { type: "text", filter: "in" },
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
  if (t === "text")
    return { sql: `${col} ILIKE ${push(`%${String(f.value)}%`)}`, params };
  if (t === "range") {
    const parts = [];
    if (f.min != null && f.min !== "") parts.push(`${col} >= ${push(f.min)}`);
    if (f.max != null && f.max !== "") parts.push(`${col} <= ${push(f.max)}`);
    return parts.length ? { sql: parts.join(" AND "), params } : null;
  }
  throw new Error(`column ${col} is not filterable`);
};

// Turn a validated request into { whereSql, params }. Scope + column filters +
// global search, all parameterized, all whitelisted.
const buildWhere = (r, req) => {
  const where = [];
  const params = [];
  const add = (built) => {
    if (!built) return;
    where.push(`(${built.sql})`);
    params.push(...built.params);
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
      throw new Error(`bad scope column: ${scope.col}`);
    params.push(scope.val);
    where.push(`${scope.col} = $${params.length}`);
  }

  for (const f of req.filters?.columns ?? []) {
    const def = r.columns[f.id];
    if (!def || !def.filter) throw new Error(`column not filterable: ${f.id}`);
    // A def may map a logical filter id to a different PHYSICAL column via `col`
    // (registry-sourced, whitelisted — never user input), so one physical column
    // can back two filter modes (e.g. tenders.cpv as exact `in` for topics AND
    // cpv_prefix as `prefix` for the normalcy "browse similar" deep link).
    add(buildFilter(def.col || f.id, def, f, params.length));
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
      if (!searchable.has(id)) throw new Error(`column not searchable: ${id}`);
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
  if (!r) throw new Error(`unknown resource: ${req.resource}`);

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
        ...(req.filters?.columns ?? []).map((f) => f.id),
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
  if (!r) throw new Error(`unknown resource: ${req.resource}`);

  // `filters` are the caller's ACTIVE facet filters (year / CPV / method / …),
  // merged with the non-editable `fixedFilters` (e.g. tag=contract). Passing them
  // makes each facet reflect the current selection — a "filter-scoped" facet. To
  // keep every option visible, the caller EXCLUDES a facet's own dimension from
  // its filter set (e.g. the procurement_method facet omits the method filter),
  // so selecting one bucket doesn't collapse the mix to that bucket alone.
  const { whereSql, params } = buildWhere(r, {
    scope: req.scope,
    filters: { columns: [...(req.fixedFilters ?? []), ...(req.filters ?? [])] },
  });
  const limit = clampInt(req.limit, 100, 1, 500);
  const cols = (req.columns ?? []).filter((c) => r.columns[c]?.filter);

  // Column ids the shared WHERE touches (scope + fixed + active filters) — used
  // per-facet to decide whether it can aggregate over the base table.
  const whereIds = [
    req.scope?.col,
    ...(req.fixedFilters ?? []).map((f) => f.id),
    ...(req.filters ?? []).map((f) => f.id),
  ];

  // Each facet is an independent query — run them concurrently rather than
  // awaiting one column at a time.
  const facets = {};
  await Promise.all(
    cols.map(async (c) => {
      const expr = r.columns[c].facetExpr || c; // registry-sourced, safe
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
};
