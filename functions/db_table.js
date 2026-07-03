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
    base: "contracts",
    scopeCols: ["contractor_eik", "awarder_eik"],
    columns: {
      key: { type: "text" },
      ocid: { type: "text" },
      tag: { type: "text", filter: "in" },
      date: { type: "date", sort: true, filter: "range" },
      date_signed: { type: "date" },
      awarder_eik: { type: "text", filter: "eq" },
      awarder_name: { type: "text", sort: true, filter: "text", search: true },
      contractor_eik: { type: "text", filter: "eq" },
      contractor_name: {
        type: "text",
        sort: true,
        filter: "text",
        search: true,
      },
      title: { type: "text", filter: "text", search: true },
      amount: { type: "number" },
      currency: { type: "text" },
      amount_eur: { type: "number", sort: true, filter: "range", agg: "sum" },
      // facetExpr groups the facet dropdown by CPV DIVISION (2-digit prefix)
      // instead of the full code; selecting one sends a prefix filter (cpv LIKE
      // '45%'). The client maps the division code → name via cpvDivisionName.
      cpv: { type: "text", filter: "prefix", facetExpr: "left(cpv, 2)" },
      procurement_method: { type: "text", sort: true, filter: "in" },
      procurement_method_rationale: { type: "text" },
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
      "cpv",
      "procurement_method",
      "procurement_method_rationale",
      "category",
      "number_of_tenderers",
      "eu_funded",
      "eu_program",
      "tender_period_start_date",
      "tender_period_end_date",
      "bundle_uuid",
      "source_url",
    ],
    defaultSort: [["date", "desc"]],
    aggregates: [{ fn: "count" }, { fn: "sum", col: "amount_eur" }],
    maxPageSize: 100,
  },
  // ЦАИС ЕОП tender-stage procedures (estimated/forecast value, NOT spend).
  // Scoped to a buyer for the per-awarder pipeline; also a global tenders browser.
  tenders: {
    base: "tenders",
    scopeCols: ["buyer_eik"],
    columns: {
      unp: { type: "text" },
      ocid: { type: "text" },
      publication_date: { type: "date", sort: true, filter: "range" },
      buyer_eik: { type: "text", filter: "eq" },
      buyer_name: { type: "text", sort: true, filter: "text", search: true },
      subject: { type: "text", filter: "text", search: true },
      procedure_type: { type: "text", sort: true, filter: "in" },
      // Exact-code `in` (not division prefix) so a curated topic deep-link can
      // filter by its precise CPV set (e.g. guardrails → 45233292, 34928…).
      cpv: { type: "text", filter: "in" },
      cpv_desc: { type: "text" },
      estimated_value_eur: {
        type: "number",
        sort: true,
        filter: "range",
        agg: "sum",
      },
      currency: { type: "text" },
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
      "lots_count",
      "is_cancelled",
      "is_framework_agreement",
      "is_eu_funded",
      "link_to_oj_eu",
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
      contract_number: { type: "text" },
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

  // NGO (ЮЛНЦ) browse — сдружения/фондации/читалища + foreign branches. The
  // client sends a fixed `entity_class in (...)` filter to scope to the NGO
  // surface; entity_class/ngo_type are also user-facing facets.
  ngos: {
    base: "tr_companies",
    scopeCols: [],
    columns: {
      uic: { type: "text" },
      name: { type: "text", sort: true, filter: "text", search: true },
      entity_class: { type: "text", sort: true, filter: "in" },
      ngo_type: { type: "text", sort: true, filter: "in" },
      seat: { type: "text", sort: true, filter: "text" },
      status: { type: "text", filter: "in" },
    },
    select: ["uic", "name", "entity_class", "ngo_type", "seat", "status"],
    defaultSort: [["name", "asc"]],
    aggregates: [{ fn: "count" }],
    maxPageSize: 100,
  },
};

const MAX_OFFSET = 100000; // deep-paging guard (use search/filters instead)
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
    const arr = Array.isArray(f.value) ? f.value : [f.value];
    if (arr.length === 0) return null;
    // Expand to individual params (col IN ($a,$b,…)) so PG infers each value's
    // type from the column — avoids "could not determine data type" on ANY().
    return { sql: `${col} IN (${arr.map((v) => push(v)).join(", ")})`, params };
  }
  if (t === "prefix")
    return { sql: `${col} LIKE ${push(`${String(f.value)}%`)}`, params };
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
    add(buildFilter(f.id, def, f, params.length));
  }

  const g = (req.filters?.global ?? "").trim();
  if (g) {
    const cols = Object.entries(r.columns)
      .filter(([, d]) => d.search)
      .map(([id]) => id);
    if (cols.length) {
      params.push(`%${g}%`);
      const n = params.length;
      where.push(`(${cols.map((c) => `${c} ILIKE $${n}`).join(" OR ")})`);
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
 * caller's query fn (dev pool or Cloud SQL pool). Returns { rows, total,
 * totalExact, page, pageSize, aggregates }.
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

  const rows = await q(
    `SELECT ${projection} FROM ${r.base} ${whereSql} ${orderSql} LIMIT ${pageSize} OFFSET ${offset}`,
    params,
  );

  // Exact count + aggregates in ONE scan when the set is bounded (scoped or
  // filtered) OR aggregates are wanted anyway; else a cheap reltuples estimate.
  const wantAgg = (r.aggregates ?? []).length > 0;
  let total;
  let totalExact;
  let aggregates = {};
  if (scoped || filtered || wantAgg) {
    const [a] = await q(
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
    const [e] = await q(
      `SELECT reltuples::bigint AS est FROM pg_class WHERE oid = $1::regclass`,
      [r.base],
    );
    total = Math.max(0, Number(e?.est ?? 0));
    totalExact = false;
  }

  return { rows, total, totalExact, page, pageSize, aggregates };
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

  const facets = {};
  for (const c of cols) {
    const expr = r.columns[c].facetExpr || c; // registry-sourced, safe
    const guard = `${expr} IS NOT NULL AND ${expr} <> ''`;
    const where = whereSql ? `${whereSql} AND (${guard})` : `WHERE ${guard}`;
    facets[c] = await q(
      `SELECT ${expr} AS value, count(*)::int AS count FROM ${r.base} ${where} GROUP BY ${expr} ORDER BY count DESC LIMIT ${limit}`,
      params,
    );
  }
  return { facets };
};

module.exports = { runDbTable, runDbFacets, REGISTRY };
