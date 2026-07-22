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
      has_appeal: { type: "bool" },
      appeal_upheld: { type: "bool" },
      tag: { type: "text", filter: "in" },
      date: { type: "date", sort: true, filter: "range" },
      date_signed: { type: "date" },
      // filter:"in" (not "eq") so a sector browse pack can pass an EIK-set
      // (awarder_eik IN (...)) as a fixedFilter — the builder wraps a scalar in
      // an array, so single-value callers are unaffected. See the water/judiciary
      // SECTOR_BROWSE_PACKS seam (docs/plans/water-view-v1.md §4.3).
      awarder_eik: { type: "text", filter: "in" },
      awarder_name: { type: "text", sort: true, filter: "text", search: true },
      contractor_eik: { type: "text", filter: "eq" },
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
    scopeCols: ["buyer_eik"],
    columns: {
      // filter:"in" so the project-file resolver can fetch procedures by УНП
      // set (unp IN (...)) — the tender side of the contract↔tender spine.
      unp: { type: "text", filter: "in" },
      ocid: { type: "text" },
      // Projected badge, not filterable — correlated EXISTS can't be index-driven
      // as a WHERE predicate (full ~125k scan). See the contracts note above.
      has_appeal: { type: "bool" },
      appeal_suspended: { type: "bool" },
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

  if (req.scope && req.scope.col) {
    if (!r.scopeCols.includes(req.scope.col))
      throw new Error(`bad scope column: ${req.scope.col}`);
    params.push(req.scope.val);
    where.push(`${req.scope.col} = $${params.length}`);
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
    const searchDefs = Object.entries(r.columns).filter(([, d]) => d.search);
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
            `(to_tsvector('simple', ${target}) @@ fold_prefix_tsquery($${i})` +
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

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const buildAggSelect = (r) => {
  const sel = ["count(*)::bigint AS _count"];
  for (const a of r.aggregates ?? []) {
    if (a.fn === "count") continue;
    const camel = cap(snakeToCamel(a.col));
    if (a.fn === "sum" && r.columns[a.col]?.agg === "sum")
      sel.push(`coalesce(sum(${a.col}),0) AS "sum${camel}"`);
    if (a.fn === "avg")
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
      const [a] = await qq(
        `SELECT ${buildAggSelect(r)} FROM ${r.base} ${whereSql}`,
        params,
      );
      total = Number(a._count);
      totalExact = true;
      aggregates = Object.fromEntries(
        Object.entries(a).filter(([k]) => k !== "_count"),
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

  const { whereSql, params } = buildWhere(r, {
    scope: req.scope,
    filters: { columns: req.fixedFilters ?? [] },
  });
  const limit = clampInt(req.limit, 100, 1, 500);
  const cols = (req.columns ?? []).filter((c) => r.columns[c]?.filter);

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
      facets[c] = await q(
        `SELECT ${expr} AS value, count(*)::int AS count FROM ${r.base} ${where} GROUP BY ${expr} ORDER BY count DESC LIMIT ${limit}`,
        params,
      );
    }),
  );
  return { facets };
};

module.exports = { runDbTable, runDbFacets, REGISTRY };
