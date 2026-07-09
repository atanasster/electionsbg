// Shared /api/db route table — ONE definition consumed by both the production
// Cloud Function (functions/index.js) and the Vite dev plugin (vite/db-api.ts),
// so dev == prod by construction and a route added here ships to both.
//
// Every handler is (dbRows, query) => Promise<{ status?, body }>, where
// `dbRows(sql, params)` is the caller's query fn (Cloud SQL pool or dev pool).
// All values are bound parameters; identifiers never come from the client.

const { runDbTable, runDbFacets } = require("./db_table.js");

const clampInt = (v, def, lo, hi) => {
  // trunc so a fractional query param (?limit=12.5) becomes a valid int rather
  // than being bound to an int SQL arg and 500-ing with 22P02.
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : def;
};

const s = (q, k) => String(q[k] || "").trim();
const orNull = (q, k) => s(q, k) || null;

// Single contract by key → ProcurementContract shape (camelCased). The columns
// common to both the enriched (contracts_list) and base (contracts) queries.
const CONTRACT_COLS = `
  key, ocid, tag, date, date_signed AS "dateSigned",
  awarder_eik AS "awarderEik", awarder_name AS "awarderName",
  awarder_region AS "awarderRegion",
  contractor_eik AS "contractorEik", contractor_eik_full AS "contractorEikFull",
  contractor_name AS "contractorName",
  amount, currency, amount_eur AS "amountEur", title, cpv,
  procurement_method AS "procurementMethod",
  procurement_method_rationale AS "procurementMethodRationale",
  number_of_tenderers AS "numberOfTenderers",
  CASE WHEN eu_funded IS NULL THEN NULL ELSE eu_funded = 1 END AS "euFunded",
  eu_program AS "euProgram",
  tender_period_start_date AS "tenderPeriodStartDate",
  tender_period_end_date AS "tenderPeriodEndDate",
  category, bundle_uuid AS "bundleUuid", source_url AS "sourceUrl"`;
const CONTRACT_SQL = `
  SELECT ${CONTRACT_COLS},
         has_appeal AS "hasAppeal", appeal_upheld AS "appealUpheld"
  FROM contracts_list WHERE key = $1 LIMIT 1`;
// Fallback for a DB predating migration 042 (contracts_list missing → 42P01):
// serve the contract without the appeal fields rather than 500 the whole page.
const CONTRACT_SQL_BASE = `
  SELECT ${CONTRACT_COLS} FROM contracts WHERE key = $1 LIMIT 1`;

// Degrade to "no appeals" ONLY for the missing-migration case (42883 =
// undefined_function): until 042 reaches this DB the appeals tile stays empty
// instead of 500-ing the whole tender page. Any other error still propagates.
const appealsOrEmpty = (e) =>
  e?.code === "42883" ? [{ r: [] }] : Promise.reject(e);

// Degrade a dedicated route to an empty result when its migration hasn't reached
// this DB yet — 42883 (undefined_function) OR 42P01 (undefined_table) — instead
// of hard-500-ing on a functions-before-db:push deploy. Real errors propagate.
const missingMigrationEmpty = (e) =>
  e?.code === "42883" || e?.code === "42P01"
    ? [{ r: [] }]
    : Promise.reject(e);

const DB_ROUTES = {
  async person(dbRows, q) {
    const name = s(q, "name");
    if (!name) return { status: 400, body: { error: "missing name" } };
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    const [roles, politicians, procurement, cabinets, associates] =
      await Promise.all([
        dbRows("SELECT * FROM person_roles($1)", [name]),
        dbRows("SELECT * FROM person_politicians($1)", [name]),
        dbRows("SELECT person_procurement($1, $2, $3) AS r", [name, from, to]),
        dbRows("SELECT * FROM person_by_cabinet($1)", [name]),
        dbRows("SELECT * FROM person_associates($1) LIMIT 500", [name]),
      ]);
    return {
      body: {
        name,
        roles,
        politicians,
        procurement: procurement[0]?.r ?? null,
        cabinets,
        associates,
      },
    };
  },
  // Distinct officer names matching (fuzzy), most-connected first.
  "person-search": async (dbRows, q) => {
    const term = s(q, "q");
    if (!term) return { status: 400, body: { error: "missing q" } };
    // Bounded server-side so a caller filters a small candidate set, not the
    // whole fuzzy match list, client-side. Default 20; the combined-search box
    // dedups by folded name and shows a handful.
    const lim = clampInt(q.limit, 20, 1, 50);
    const people = await dbRows(
      `SELECT o.name, count(DISTINCT o.uic) AS companies
       FROM tr_officers o
       WHERE o.name_fold %> translit_bg_latin($1)
         AND (SELECT bool_and(tok <% o.name_fold)
              FROM unnest(string_to_array(translit_bg_latin($1),' ')) tok WHERE tok<>'')
       GROUP BY o.name
       ORDER BY companies DESC, length(o.name)
       LIMIT $2`,
      [term, lim],
    );
    return { body: { people } };
  },
  async company(dbRows, q) {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const [
      company,
      summary,
      officers,
      politicians,
      procurement,
      cabinets,
      debarred,
      funds,
      relationships,
      sectors,
      related,
      institution,
      geography,
      awarderProcurement,
      fundProjects,
      ngoDetails,
      awarderKindex,
      ngoFunding,
      awarderRiskGrade,
      supplierRiskGrade,
      corpusName,
      subsidies,
    ] = await Promise.all([
      dbRows(
        "SELECT uic, name, legal_form, seat, status, funds_amount, funds_currency, entity_class, ngo_type FROM tr_companies WHERE uic = $1",
        [eik],
      ),
      dbRows(
        "SELECT count(*)::int AS contracts, coalesce(sum(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS contracts_eur FROM contracts WHERE contractor_eik = $1",
        [eik],
      ),
      // Bounded: a few pathological holdings have thousands of officer rows —
      // the page previews a handful and links to the paginated officers table.
      dbRows("SELECT * FROM company_officers($1) LIMIT 500", [eik]),
      dbRows(
        "SELECT politician, ref, kind, role, total_eur FROM company_politicians WHERE eik = $1 ORDER BY total_eur DESC NULLS LAST LIMIT 200",
        [eik],
      ),
      dbRows("SELECT company_procurement($1, $2, $3) AS r", [
        eik,
        orNull(q, "from"),
        orNull(q, "to"),
      ]),
      dbRows("SELECT * FROM company_by_cabinet($1)", [eik]),
      dbRows("SELECT * FROM company_debarred($1)", [eik]),
      dbRows("SELECT * FROM fund_beneficiaries WHERE eik = $1", [eik]),
      dbRows("SELECT company_buyer_relationships($1) AS r", [eik]),
      dbRows("SELECT company_sectors($1) AS r", [eik]),
      dbRows("SELECT company_related($1) AS r", [eik]),
      dbRows("SELECT institution_identity($1) AS r", [eik]),
      dbRows("SELECT company_geography($1) AS r", [eik]),
      dbRows("SELECT awarder_procurement($1, $2, $3) AS r", [
        eik,
        orNull(q, "from"),
        orNull(q, "to"),
      ]),
      dbRows(
        `SELECT contract_number, title, program_name, total_eur, paid_eur, status, duration_months
         FROM fund_projects WHERE beneficiary_eik = $1
         ORDER BY total_eur DESC NULLS LAST LIMIT 6`,
        [eik],
      ),
      dbRows(
        "SELECT public_benefit, private_benefit, objectives, means FROM ngo_details WHERE uic = $1",
        [eik],
      ),
      // Awarder K-Index (share of the buyer's contract value to politician /
      // NGO-board-linked suppliers). Returns a zero-ish payload for non-awarders.
      dbRows("SELECT awarder_kindex($1) AS r", [eik]),
      // External funding received (EU direct / state subsidy / foreign grants).
      dbRows("SELECT ngo_funding_for($1) AS r", [eik]),
      // Multi-component A–F risk grade — as a BUYER and as a SUPPLIER. Null when
      // the entity has no contracts in that role. Both <90ms worst-case (live).
      // Guarded on the missing-migration case ONLY (42883 = undefined_function):
      // until migration 041 lands on this DB these functions don't exist, so
      // degrade the two grade tiles to null instead of 500-ing the whole company
      // page. A real outage (timeout, pool exhaustion) still propagates.
      dbRows("SELECT awarder_risk_grade($1) AS r", [eik]).catch((e) =>
        e?.code === "42883" ? [] : Promise.reject(e),
      ),
      dbRows("SELECT supplier_risk_grade($1) AS r", [eik]).catch((e) =>
        e?.code === "42883" ? [] : Promise.reject(e),
      ),
      // Representative name as it appears in the procurement corpus — the only
      // identity we have for a contractor/awarder absent from the TR register
      // (foreign / deregistered). Both lookups are eik-indexed. Prefer the
      // longest variant (most complete legal name); sell-side then buy-side.
      dbRows(
        `SELECT coalesce(
           (SELECT name FROM contractor_search WHERE eik = $1
              ORDER BY length(name) DESC LIMIT 1),
           (SELECT name FROM awarder_search WHERE eik = $1
              ORDER BY length(name) DESC LIMIT 1)
         ) AS name`,
        [eik],
      ).catch((e) => (e?.code === "42P01" ? [] : Promise.reject(e))),
      // ДФ „Земеделие" farm-subsidy rollup for this EIK (cross-program money map:
      // subsidies alongside procurement + EU funds). null when no subsidies (or
      // migration 046 not yet applied).
      dbRows(
        "SELECT payload FROM agri_payloads WHERE kind = 'recipient' AND key = $1",
        [eik],
      ).catch((e) => (e?.code === "42P01" ? [] : Promise.reject(e))),
    ]);
    return {
      body: {
        eik,
        company: company[0] ?? null,
        summary: summary[0] ?? null,
        officers,
        politicians,
        procurement: procurement[0]?.r ?? null,
        cabinets,
        debarred,
        funds: funds[0] ?? null,
        relationships: relationships[0]?.r ?? null,
        sectors: sectors[0]?.r ?? null,
        related: related[0]?.r ?? null,
        institution: institution[0]?.r ?? null,
        geography: geography[0]?.r ?? null,
        awarderProcurement: awarderProcurement[0]?.r ?? null,
        fundProjects,
        ngoDetails: ngoDetails[0] ?? null,
        awarderKindex: awarderKindex[0]?.r ?? null,
        ngoFunding: ngoFunding[0]?.r ?? null,
        awarderRiskGrade: awarderRiskGrade[0]?.r ?? null,
        supplierRiskGrade: supplierRiskGrade[0]?.r ?? null,
        corpusName: corpusName[0]?.name ?? null,
        subsidies: subsidies[0]?.payload ?? null,
      },
    };
  },
  async table(dbRows, q) {
    let req;
    try {
      req = JSON.parse(q.q || "{}");
    } catch {
      return { status: 400, body: { error: "bad q" } };
    }
    return { body: await runDbTable(dbRows, req) };
  },
  async facets(dbRows, q) {
    let req;
    try {
      req = JSON.parse(q.q || "{}");
    } catch {
      return { status: 400, body: { error: "bad q" } };
    }
    return { body: await runDbFacets(dbRows, req) };
  },
  // Registry-scale stat cards for the /procurement/ngos header. One round-trip,
  // ~14ms: entity_class counts hit the index, the register total is the pg_class
  // reltuples estimate (exact enough for a headline, no 1M-row scan), and the
  // state-awarder count reads the awarder_totals matview (one row per awarder).
  "ngo-stats": async (dbRows) => {
    const rows = await dbRows(
      `SELECT
         (SELECT count(*)::int FROM tr_companies WHERE entity_class = 'ngo_assoc')      AS assoc,
         (SELECT count(*)::int FROM tr_companies WHERE entity_class = 'ngo_found')      AS found,
         (SELECT count(*)::int FROM tr_companies WHERE entity_class = 'chitalishte')    AS chitalishte,
         (SELECT count(*)::int FROM tr_companies WHERE entity_class = 'foreign_branch') AS foreign_branch,
         (SELECT reltuples::bigint FROM pg_class WHERE relname = 'tr_companies')        AS tr_companies,
         (SELECT count(*)::int FROM awarder_totals)                                     AS state_awarders,
         (SELECT count(DISTINCT eik)::int FROM ngo_funding WHERE eik IS NOT NULL)       AS ngos_funded,
         (SELECT COALESCE(ROUND(SUM(amount_eur)), 0) FROM ngo_funding WHERE eik IS NOT NULL) AS external_eur
       `,
    );
    return { body: rows[0] ?? {} };
  },
  async tenders(dbRows, q) {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const limit = clampInt(q.limit, 25, 1, 200);
    const sort = s(q, "sort") === "value" ? "value" : "date";
    const [summary, recent] = await Promise.all([
      dbRows("SELECT * FROM tenders_buyer_summary($1)", [eik]),
      dbRows("SELECT * FROM tenders_by_buyer($1, $2, $3)", [eik, limit, sort]),
    ]);
    return { body: { eik, summary: summary[0] ?? null, recent } };
  },
  // Single tender by УНП or ocid → { tender: <FE Tender shape>, awards[] } in
  // one call (tender_detail, 032). Serves both /tenders/:unp and the
  // contract→tender lineage tile.
  async tender(dbRows, q) {
    const ocid = s(q, "ocid");
    const unp = s(q, "unp");
    if (!ocid && !unp)
      return { status: 400, body: { error: "missing ocid or unp" } };
    // КЗК appeals key on the УНП (exact join). On the hot ?unp= path (every
    // fact-check link) the unp is known up front, so fetch appeals in parallel
    // with the detail; only the ocid-only lineage tile needs the sequential
    // fallback (unp comes from the detail result).
    const [rows, appealsPre] = await Promise.all([
      dbRows("SELECT tender_detail($1, $2) AS r", [unp || null, ocid || null]),
      unp
        ? dbRows("SELECT tender_appeals($1) AS r", [unp]).catch(appealsOrEmpty)
        : Promise.resolve(null),
    ]);
    const detail = rows[0]?.r ?? { tender: null, awards: [] };
    let appeals = appealsPre ? (appealsPre[0]?.r ?? []) : [];
    if (!unp && detail.tender?.unp) {
      appeals =
        (
          await dbRows("SELECT tender_appeals($1) AS r", [
            detail.tender.unp,
          ]).catch(appealsOrEmpty)
        )[0]?.r ?? [];
    }
    return { body: { ...detail, appeals } };
  },
  async connection(dbRows, q) {
    const a = s(q, "a");
    const b = s(q, "b");
    if (!a || !b) return { status: 400, body: { error: "missing a or b" } };
    return {
      body: {
        a,
        b,
        shared: await dbRows("SELECT * FROM connection_between($1, $2)", [
          a,
          b,
        ]),
      },
    };
  },
  // Company ↔ person connection check: direct roles + 1-hop bridges
  // (company_connection) AND the shortest multi-hop path up to 3 degrees.
  "company-connection": async (dbRows, q) => {
    const eik = s(q, "eik");
    const name = s(q, "name");
    if (!eik || !name)
      return { status: 400, body: { error: "missing eik or name" } };
    const [conn, path] = await Promise.all([
      dbRows("SELECT company_connection($1, $2) AS r", [eik, name]),
      dbRows("SELECT company_person_path($1, $2, 3) AS r", [eik, name]),
    ]);
    const c = conn[0]?.r ?? { direct: [], shared: [] };
    return {
      body: {
        direct: c.direct ?? [],
        shared: c.shared ?? [],
        path: path[0]?.r ?? null,
      },
    };
  },
  // Sector competitors — lazy per-division.
  "sector-peers": async (dbRows, q) => {
    const division = s(q, "division");
    if (!division) return { status: 400, body: { error: "missing division" } };
    // eik is OPTIONAL. With it, the caller's company is flagged isSelf and
    // pulled in even if outside the division's top 8 (company page). Without it
    // (the state-wide /procurement/sectors page), s() yields "" — no contractor
    // matches, so the top 8 come back unflagged.
    const eik = s(q, "eik");
    // Optional date window (?from/?to, from ?pscope): when set, rank live within
    // the window so the panel matches the window-scoped division totals; corpus
    // scope (no window) uses the fast precomputed matview.
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    const rows =
      from || to
        ? await dbRows("SELECT sector_peers_window($1, $2, $3, $4) AS r", [
            division,
            eik,
            from,
            to,
          ])
        : await dbRows("SELECT sector_peers($1, $2) AS r", [division, eik]);
    return { body: rows[0]?.r ?? { division, peers: [] } };
  },
  async search(dbRows, q) {
    const term = s(q, "q");
    if (!term) return { status: 400, body: { error: "missing q" } };
    return {
      body: {
        q: term,
        results: await dbRows("SELECT * FROM search_all($1, $2)", [
          term,
          clampInt(q.limit, 30, 1, 100),
        ]),
      },
    };
  },
  // Single contract by key → ProcurementContract shape.
  contract: async (dbRows, q) => {
    const key = s(q, "key");
    if (!key) return { status: 400, body: { error: "missing key" } };
    // 42P01 (contracts_list view absent = migration 042 not yet applied) →
    // degrade to the base contracts table so /contract/:key still renders.
    const rows = await dbRows(CONTRACT_SQL, [key]).catch((e) =>
      e?.code === "42P01" ? dbRows(CONTRACT_SQL_BASE, [key]) : Promise.reject(e),
    );
    return { body: { contract: rows[0] ?? null } };
  },
  // Risk-signals feed — top concentration + top MP-tied + headline counts +
  // per-oblast tally, window-scoped or full corpus.
  "procurement-risk-feed": async (dbRows, q) => {
    const rows = await dbRows("SELECT procurement_risk_feed($1, $2) AS r", [
      orNull(q, "from"),
      orNull(q, "to"),
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // Public-money scanner — the full political-class (MP + official) procurement
  // index, window-scoped or full corpus.
  "procurement-scanner": async (dbRows, q) => {
    const rows = await dbRows("SELECT procurement_scanner($1, $2) AS r", [
      orNull(q, "from"),
      orNull(q, "to"),
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // By-place: local-tier settlements + national card, window-scoped or full corpus.
  "procurement-by-settlement": async (dbRows, q) => {
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    // Full-corpus scope → cache matview (030); the live aggregate is ~388ms.
    if (!from && !to) {
      try {
        const c = await dbRows(
          "SELECT r FROM procurement_by_settlement_cache",
          [],
        );
        if (c[0]?.r) return { body: c[0].r };
      } catch {
        // matview absent — fall through to the live computation
      }
    }
    const rows = await dbRows("SELECT procurement_by_settlement($1, $2) AS r", [
      from,
      to,
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // Per-settlement detail (awarders + top contracts + by-year).
  "procurement-settlement": async (dbRows, q) => {
    const ekatte = s(q, "ekatte");
    if (!ekatte) return { status: 400, body: { error: "missing ekatte" } };
    const rows = await dbRows(
      "SELECT procurement_settlement_detail($1, $2, $3) AS r",
      [ekatte, orNull(q, "from"), orNull(q, "to")],
    );
    return { body: rows[0]?.r ?? null };
  },
  // Money-flow Sankey (awarder → politician-tied contractor → mp|official).
  "procurement-flow": async (dbRows, q) => {
    const rows = await dbRows("SELECT procurement_flow($1, $2) AS r", [
      orNull(q, "from"),
      orNull(q, "to"),
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // Single-supplier concentration cases (buyer→supplier ≥30%, buyer ≥€100k).
  "procurement-concentration": async (dbRows, q) => {
    const rows = await dbRows("SELECT procurement_concentration($1, $2) AS r", [
      orNull(q, "from"),
      orNull(q, "to"),
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // Procurement dashboard overview — totals + treemaps + connected-people lists,
  // scoped to a parliament window [from, to) or the full corpus (both NULL).
  "procurement-overview": async (dbRows, q) => {
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    // Full-corpus (all-years) scope → the load-time cache matview (025); the
    // live aggregate is ~334ms. Windowed scopes fall through to the function.
    if (!from && !to) {
      try {
        const c = await dbRows("SELECT r FROM procurement_overview_cache", []);
        if (c[0]?.r) return { body: c[0].r };
      } catch {
        // matview absent — fall through to the live computation
      }
    }
    const rows = await dbRows("SELECT procurement_overview($1, $2) AS r", [
      from,
      to,
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // National CPV-division totals ("what does the state buy"), window-scoped
  // [from, to) or full corpus.
  "procurement-sectors": async (dbRows, q) => {
    const rows = await dbRows("SELECT procurement_sectors($1, $2) AS r", [
      orNull(q, "from"),
      orNull(q, "to"),
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // EU Single Market Scoreboard competition indicators (single-bidder share,
  // no-call-for-bids share), window-scoped [from, to) or full corpus.
  "procurement-benchmarks": async (dbRows, q) => {
    const rows = await dbRows("SELECT procurement_benchmarks($1, $2) AS r", [
      orNull(q, "from"),
      orNull(q, "to"),
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // Full "see all" rankings (top contractors / awarders / MPs / officials),
  // window-scoped [from, to) or full corpus — the big-list sibling of
  // procurement-overview.
  "procurement-rankings": async (dbRows, q) => {
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    // Full-corpus scope (all-years + the AI fiscal tools) → cache matview (031);
    // the live aggregate is ~530ms.
    if (!from && !to) {
      try {
        const c = await dbRows("SELECT r FROM procurement_rankings_cache", []);
        if (c[0]?.r) return { body: c[0].r };
      } catch {
        // matview absent — fall through to the live computation
      }
    }
    const rows = await dbRows("SELECT procurement_rankings($1, $2) AS r", [
      from,
      to,
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // National "recent КЗК appeals" feed — top-N from kzk_recent_appeals (042),
  // each joined to its tender by УНП. ?limit (≤200).
  "kzk-appeals": async (dbRows, q) => {
    const limit = clampInt(q.limit, 30, 1, 200);
    const rows = await dbRows("SELECT kzk_recent_appeals($1) AS r", [
      limit,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  // Buyer risk-grade leaderboard ("riskiest institutions") — top-N from the
  // precomputed awarder_risk_grade_scoped table (041). ?scope selects the pscope
  // window ('all' | 'y:<year>' | 'ns:<election>', default 'all'); ?limit (≤200);
  // ?minScore (grade floor — 55 is the E floor, 70 the F floor). One jsonb trip.
  "awarder-risk-top": async (dbRows, q) => {
    const scope = s(q, "scope") || "all";
    const limit = clampInt(q.limit, 20, 1, 200);
    const minScore = clampInt(q.minScore, 0, 0, 100);
    // Payload is { requested, scope, rows } (scope = the effective key served —
    // may differ from `requested` on a fallback). Degrade to an empty payload of
    // that shape when the migration is absent (42883/42P01).
    const rows = await dbRows(
      "SELECT awarder_risk_grade_top($1, $2, $3) AS r",
      [scope, limit, minScore],
    ).catch((e) =>
      e?.code === "42883" || e?.code === "42P01"
        ? []
        : Promise.reject(e),
    );
    return { body: rows[0]?.r ?? { requested: scope, scope, rows: [] } };
  },
  // Consolidated client-side risk-scorer indexes (debarred register,
  // awarder→contractor concentration pairs, MP/official-connected EIK sets,
  // per-CPV-division competition baseline) — one payload, corpus-scoped.
  // Served from the load-time matview (the live function is a full-corpus
  // aggregate, ~2.8s warm on Cloud SQL); falls back to the live function on
  // a DB that predates the cache.
  "procurement-risk-indexes": async (dbRows) => {
    try {
      const rows = await dbRows(
        "SELECT r FROM procurement_risk_indexes_cache",
        [],
      );
      if (rows[0]?.r) return { body: rows[0].r };
    } catch {
      // matview absent — fall through to the live computation
    }
    const rows = await dbRows("SELECT procurement_risk_indexes() AS r", []);
    return { body: rows[0]?.r ?? null };
  },
  // Every contract row for one awarder (ProcurementContract shape) — the road
  // dashboard's model input. Bounded: the biggest buyer (АПИ) has ~2.1k rows.
  "awarder-contracts": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const limit = clampInt(q.limit, 10000, 1, 25000);
    const contracts = await dbRows(
      `SELECT key, ocid, tag, date, date_signed AS "dateSigned",
              awarder_eik AS "awarderEik", awarder_name AS "awarderName",
              contractor_eik AS "contractorEik", contractor_name AS "contractorName",
              amount, currency, amount_eur AS "amountEur", title, cpv,
              procurement_method AS "procurementMethod",
              number_of_tenderers AS "numberOfTenderers",
              CASE WHEN eu_funded IS NULL THEN NULL ELSE eu_funded = 1 END AS "euFunded",
              eu_program AS "euProgram", category, source_url AS "sourceUrl"
       FROM contracts WHERE awarder_eik = $1
       ORDER BY date DESC, key LIMIT $2`,
      [eik, limit],
    );
    return { body: { eik, contracts } };
  },
  // Lightweight awarder rollup (as a BUYER): top suppliers (byContractor),
  // by-year series + headline totals — the same awarder_procurement() the
  // /awarder page's company payload embeds, plus the awarder's own name (the
  // function omits it) from awarder_search. Window-scoped [from, to) or full.
  "awarder-procurement": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const [roll, named] = await Promise.all([
      dbRows("SELECT awarder_procurement($1, $2, $3) AS r", [
        eik,
        orNull(q, "from"),
        orNull(q, "to"),
      ]),
      // Canonical display name = the modal awarder_name across this eik's
      // contracts (awarder_search carries several spellings per eik).
      dbRows(
        `SELECT awarder_name AS name FROM contracts WHERE awarder_eik = $1
         GROUP BY awarder_name ORDER BY count(*) DESC, length(awarder_name) LIMIT 1`,
        [eik],
      ),
    ]);
    const r = roll[0]?.r ?? null;
    if (r && named[0]?.name) r.name = named[0].name;
    return { body: r };
  },
  // Full grouped counterparty list for one entity — every awarder that paid a
  // company (side=contractor) or every contractor a state buyer paid
  // (side=awarder), with the MP-tie badge inline.
  //
  // DELIBERATELY UNBOUNDED — a known exception to this file's LIMIT policy:
  // these are the "see everyone" breakdown pages, and the result is naturally
  // capped by grouping (one row per distinct counterparty; the biggest buyer,
  // АПИ, has ~2.1k). The 1h CDN cache absorbs the two aggregate scans.
  "company-counterparties": async (dbRows, q) => {
    const eik = s(q, "eik");
    const side = s(q, "side") === "awarder" ? "awarder" : "contractor";
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const me = side === "awarder" ? "awarder" : "contractor";
    const other = side === "awarder" ? "contractor" : "awarder";
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    // SECURITY: `me`/`other` are spliced into SQL as identifiers — they MUST
    // stay this fixed two-branch ternary; never derive them from client text.
    // from/to are bound params ($2/$3), inclusive — the date-scope pill.
    const entries = await dbRows(
      `WITH mine AS (
         SELECT ${other}_eik AS eik, ${other}_name AS name, tag,
                amount, currency, amount_eur
         FROM contracts
         WHERE ${me}_eik = $1 AND ${other}_eik IS NOT NULL AND ${other}_eik <> ''
           AND ($2::text IS NULL OR date >= $2::text)
           AND ($3::text IS NULL OR date <= $3::text)
       ),
       others AS (
         SELECT eik, jsonb_object_agg(cur, s2) AS other FROM (
           SELECT eik, currency AS cur, ROUND(SUM(amount)) AS s2
           FROM mine
           WHERE tag = 'contract' AND amount_eur IS NULL
             AND amount IS NOT NULL AND currency IS NOT NULL
           GROUP BY eik, currency
         ) q GROUP BY eik
       )
       SELECT g.eik, g.name, g."totalEur",
              COALESCE(o.other, '{}'::jsonb) AS "totalOther",
              g."contractCount",
              EXISTS (SELECT 1 FROM company_politicians cp
                      WHERE cp.eik = g.eik AND cp.kind = 'mp') AS "mpTied"
       FROM (
         SELECT eik, MIN(name) AS name,
                ROUND(COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0)) AS "totalEur",
                (COUNT(*) FILTER (WHERE tag = 'contract'))::int AS "contractCount"
         FROM mine
         GROUP BY eik
         HAVING COUNT(*) FILTER (WHERE tag = 'contract') > 0
       ) g
       LEFT JOIN others o ON o.eik = g.eik
       ORDER BY g."totalEur" DESC NULLS LAST`,
      [eik, from, to],
    );
    // Contract rows carry several name aliases per EIK (АПИ vs its regional
    // ОПУ branches) — pick the most frequent one as the display name.
    const name = await dbRows(
      `SELECT ${me}_name AS name FROM contracts WHERE ${me}_eik = $1
       GROUP BY ${me}_name ORDER BY count(*) DESC LIMIT 1`,
      [eik],
    );
    return { body: { eik, side, name: name[0]?.name ?? null, entries } };
  },
  // Light per-entity activity signature for the watchlist — contract count,
  // total, latest date, top counterparty — one indexed aggregate per followed
  // company / awarder / place.
  "watch-signature": async (dbRows, q) => {
    const id = s(q, "id");
    const kind = s(q, "kind");
    if (!id) return { status: 400, body: { error: "missing id" } };
    if (kind === "company" || kind === "awarder") {
      // SECURITY: `me`/`other` are spliced into SQL as identifiers — they MUST
      // stay this fixed two-branch ternary; never derive them from client text.
      const me = kind === "company" ? "contractor" : "awarder";
      const other = kind === "company" ? "awarder" : "contractor";
      const rows = await dbRows(
        `SELECT (COUNT(*) FILTER (WHERE tag = 'contract'))::int AS count,
                ROUND(COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0)) AS "totalEur",
                COALESCE(MAX(date) FILTER (WHERE tag = 'contract'), '') AS "latestDate",
                (SELECT COALESCE(jsonb_object_agg(cur, s2), '{}'::jsonb) FROM (
                   SELECT currency AS cur, ROUND(SUM(amount)) AS s2
                   FROM contracts c2
                   WHERE c2.${me}_eik = $1 AND c2.tag = 'contract'
                     AND c2.amount_eur IS NULL AND c2.amount IS NOT NULL
                     AND c2.currency IS NOT NULL
                   GROUP BY currency
                ) o) AS "totalOther"
         FROM contracts WHERE ${me}_eik = $1`,
        [id],
      );
      const top = await dbRows(
        `SELECT ${other}_eik AS eik, MIN(${other}_name) AS name
         FROM contracts
         WHERE ${me}_eik = $1 AND tag = 'contract'
           AND ${other}_eik IS NOT NULL AND ${other}_eik <> ''
         GROUP BY ${other}_eik
         ORDER BY SUM(amount_eur) DESC NULLS LAST LIMIT 1`,
        [id],
      );
      const sig = rows[0] ?? null;
      if (!sig || sig.count === 0) return { body: { found: false } };
      return {
        body: {
          found: true,
          ...sig,
          topEik: top[0]?.eik ?? null,
          topName: top[0]?.name ?? null,
          topKind: kind === "company" ? "awarder" : "company",
        },
      };
    }
    if (kind === "place") {
      const rows = await dbRows(
        `SELECT (COUNT(*) FILTER (WHERE c.tag = 'contract'))::int AS count,
                ROUND(COALESCE(SUM(c.amount_eur) FILTER (WHERE c.tag = 'contract'), 0)) AS "totalEur",
                COALESCE(MAX(c.date) FILTER (WHERE c.tag = 'contract'), '') AS "latestDate",
                (SELECT COALESCE(jsonb_object_agg(cur, s2), '{}'::jsonb) FROM (
                   SELECT c2.currency AS cur, ROUND(SUM(c2.amount)) AS s2
                   FROM contracts c2
                   JOIN awarder_seats s3 ON s3.eik = c2.awarder_eik
                   WHERE s3.ekatte = $1 AND s3.source = 'geo' AND s3.is_local_hq
                     AND c2.tag = 'contract' AND c2.amount_eur IS NULL
                     AND c2.amount IS NOT NULL AND c2.currency IS NOT NULL
                   GROUP BY c2.currency
                ) o) AS "totalOther"
         FROM contracts c
         JOIN awarder_seats s ON s.eik = c.awarder_eik
         WHERE s.ekatte = $1 AND s.source = 'geo' AND s.is_local_hq`,
        [id],
      );
      const top = await dbRows(
        `SELECT c.awarder_eik AS eik, MIN(c.awarder_name) AS name
         FROM contracts c
         JOIN awarder_seats s ON s.eik = c.awarder_eik
         WHERE s.ekatte = $1 AND s.source = 'geo' AND s.is_local_hq
           AND c.tag = 'contract'
         GROUP BY c.awarder_eik
         ORDER BY SUM(c.amount_eur) DESC NULLS LAST LIMIT 1`,
        [id],
      );
      const sig = rows[0] ?? null;
      if (!sig || sig.count === 0) return { body: { found: false } };
      return {
        body: {
          found: true,
          ...sig,
          topEik: top[0]?.eik ?? null,
          topName: top[0]?.name ?? null,
          topKind: "awarder",
        },
      };
    }
    return { status: 400, body: { error: "bad kind" } };
  },
  // Per-politician procurement detail (candidate/officials procurement pages):
  // every linked contractor with live totals, byYear and top awarders.
  "ref-procurement": async (dbRows, q) => {
    const ref = s(q, "ref");
    if (!ref) return { status: 400, body: { error: "missing ref" } };
    const rows = await dbRows("SELECT ref_procurement($1) AS r", [ref]);
    return { body: rows[0]?.r ?? null };
  },
  // One MP's connected-contract scorecard metric (value + rank + cohort) for the
  // candidate-page scorecard tile — replaces the derived/per-mp/ shard fetch.
  "mp-scorecard": async (dbRows, q) => {
    const mpId = parseInt(s(q, "mpId"), 10);
    if (!Number.isFinite(mpId))
      return { status: 400, body: { error: "missing mpId" } };
    const rows = await dbRows("SELECT mp_scorecard($1) AS r", [mpId]);
    return { body: rows[0]?.r ?? null };
  },
  // The MPs / officials declared as officers/owners of one contractor — the
  // "connected people" chips on contract/company pages. `relations` is the
  // full jsonb from the connections pipeline (kind/isCurrent/shareSize/
  // confidence), so chips keep "(former)" / "declared stake N%" fidelity.
  "company-politicians": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const entries = await dbRows(
      `SELECT politician, ref, kind, role, relations, total_eur AS "totalEur"
       FROM company_politicians WHERE eik = $1
       ORDER BY total_eur DESC NULLS LAST LIMIT 200`,
      [eik],
    );
    return { body: { eik, entries } };
  },
  // Contractor name search for the procurement dashboard tile — any firm that
  // signed a public contract, deduped to one row per eik (best-matching name).
  "company-search": async (dbRows, q) => {
    const term = s(q, "q");
    if (!term) return { status: 400, body: { error: "missing q" } };
    const companies = await dbRows(
      `WITH s AS (SELECT * FROM search_contractors($1, 60))
       SELECT eik, name, contracts, contracts_eur AS "contractsEur"
       FROM (
         SELECT DISTINCT ON (eik) eik, name, contracts, contracts_eur, sim
         FROM s ORDER BY eik, sim DESC, length(name)
       ) d
       ORDER BY sim DESC, length(name), eik
       LIMIT 20`,
      [term],
    );
    return { body: { companies } };
  },
  // Combined procurement search — one query, grouped results: contractors,
  // buyers (deduped to one row per eik — corpus rows carry name aliases),
  // contract subjects and tender subjects. Persons are merged client-side from
  // person_procurement_index.json (bilingual token matching lives there).
  //
  // DEPLOY COUPLING: needs schema pg/035_procurement_search.sql applied and
  // awarder_search / contracts.title_fold rebuilt before this route is live —
  // see docs/plans/procurement-dashboard-redesign-v1.md for the checklist.
  //
  // allSettled, not all: a failing group (e.g. search_tender_subjects on a DB
  // where tenders isn't loaded yet) degrades that group to [] instead of
  // blanking every entity type in the search box.
  "procurement-search": async (dbRows, q) => {
    const term = s(q, "q");
    if (!term) return { status: 400, body: { error: "missing q" } };
    const lim = clampInt(q.limit, 6, 1, 20);
    const dedupByEik = (fn) => `
      WITH s AS (SELECT * FROM ${fn}($1, 60))
      SELECT eik, name, contracts, contracts_eur AS "contractsEur"
      FROM (
        SELECT DISTINCT ON (eik) eik, name, contracts, contracts_eur, sim
        FROM s ORDER BY eik, sim DESC, length(name)
      ) d
      ORDER BY sim DESC, length(name), eik
      LIMIT $2`;
    const settled = await Promise.allSettled([
      dbRows(dedupByEik("search_contractors"), [term, lim]),
      dbRows(dedupByEik("search_awarders"), [term, lim]),
      dbRows(
        `SELECT key, title, date, awarder_name AS "awarderName",
                contractor_name AS "contractorName", amount_eur AS "amountEur"
         FROM search_contract_titles($1, $2)`,
        [term, lim],
      ),
      dbRows(
        `SELECT unp, subject, publication_date AS "publicationDate",
                buyer_name AS "buyerName",
                estimated_value_eur AS "estimatedValueEur"
         FROM search_tender_subjects($1, $2)`,
        [term, lim],
      ),
    ]);
    const [companies, awarders, contracts, tenders] = settled.map((r) =>
      r.status === "fulfilled" ? r.value : [],
    );
    return { body: { companies, awarders, contracts, tenders } };
  },
  // openTenders corpus path (topic / free-keyword / bare-year) → matched top-N
  // rows + full-set aggregates (count, Σ estimate, cancelled, biggest). Topic
  // match = subject/CPV-description regex OR exact-CPV membership, mirroring
  // @/lib/tenderTopics.tenderMatchesTopic. `cpv` is a comma-joined code list and
  // `buyerTokens` a comma-joined token list (both optional); `pattern`/`keyword`
  // are bound VALUES (never spliced), and the READ ONLY tx + statement_timeout
  // bound any regex cost. Degrades to an empty payload on a tenders-less DB.
  "tender-corpus-search": async (dbRows, q) => {
    const year = Number.isFinite(Number(q.year))
      ? Math.trunc(Number(q.year))
      : null;
    const cpv = s(q, "cpv") ? s(q, "cpv").split(",").filter(Boolean) : [];
    const tokens = s(q, "buyerTokens")
      ? s(q, "buyerTokens").split(",").filter(Boolean)
      : [];
    const limit = clampInt(q.limit, 12, 1, 50);
    const rows = await dbRows(
      "SELECT tender_corpus_search($1, $2, $3, $4, $5, $6) AS r",
      [year, cpv, orNull(q, "pattern"), orNull(q, "keyword"), tokens, limit],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // procurementAppeals corpus rollup — totals + per-year + top-25 buyers (port of
  // build_kzk_summary.ts). Empty payload on a DB without the migration/kzk table.
  "kzk-appeals-summary": async (dbRows) => {
    const rows = await dbRows("SELECT kzk_appeals_summary() AS r", []).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? null };
  },
  // АОП debarred-suppliers register — the still-active debarments (open-ended or
  // not yet lapsed), newest expiry first, + the historical total. now() under the
  // READ ONLY tx dates the "active" cut. Serves procurementDebarred + the
  // active_debarred count on procurementRedFlags.
  async debarred(dbRows) {
    const activePred =
      "(debarred_until IS NULL OR debarred_until = '' OR debarred_until >= to_char(now(), 'YYYY-MM-DD'))";
    const [entries, totals] = await Promise.all([
      dbRows(
        `SELECT name, published_at AS "publishedAt",
                debarred_until AS "debarredUntil", details_url AS "detailsUrl"
         FROM debarred WHERE ${activePred}
         ORDER BY debarred_until DESC NULLS LAST, name`,
        [],
      ).catch(missingMigrationEmpty),
      dbRows(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE ${activePred})::int AS active
         FROM debarred`,
        [],
      ).catch(() => [{ total: 0, active: 0 }]),
    ]);
    return {
      body: {
        entries,
        total: totals[0]?.total ?? 0,
        active: totals[0]?.active ?? 0,
      },
    };
  },
  async recent(dbRows, q) {
    return {
      body: {
        rows: await dbRows("SELECT * FROM recent_updates($1, $2)", [
          clampInt(q.days, 1, 1, 3650),
          clampInt(q.limit, 200, 1, 1000),
        ]),
      },
    };
  },

  // ── ИСУН EU-funds serving (mirrors the retired data/funds/ GCS JSON) ─────────
  // Every precomputed funds page payload is stored verbatim in fund_payloads
  // keyed by (kind, key); a fetch is one PK seek returning the jsonb (or null
  // when the place/programme/entity has no funds activity — the hooks render a
  // nothing-friendly empty state, same as the old 404 → null behaviour).
  "fund-payload": async (dbRows, q) => {
    const kind = s(q, "kind");
    if (!kind) return { status: 400, body: { error: "missing kind" } };
    const key = s(q, "key"); // '' for singletons
    const rows = await dbRows(
      "SELECT payload FROM fund_payloads WHERE kind = $1 AND key = $2",
      [kind, key],
    );
    return { body: rows[0]?.payload ?? null };
  },
  // Per-beneficiary rollup → FundsBeneficiary (was beneficiaries-by-eik/{eik}).
  "fund-beneficiary": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows("SELECT fund_beneficiary_detail($1) AS r", [eik]);
    return { body: rows[0]?.r ?? null };
  },
  // Single project detail → FundsProjectsContractFile (was by-contract/{key}).
  "fund-contract": async (dbRows, q) => {
    const key = s(q, "key");
    if (!key) return { status: 400, body: { error: "missing key" } };
    const rows = await dbRows("SELECT fund_contract_detail($1) AS r", [key]);
    return { body: rows[0]?.r ?? null };
  },

  // ── ДФ „Земеделие" subsidies serving (agri_payloads, migration 046) ──────────
  // Every precomputed /subsidies page payload is stored verbatim keyed by
  // (kind, key): 'overview' (key '') = the national dashboard; 'recipient'
  // (key = eik) = a per-legal-entity rollup. One PK seek → the jsonb (or null
  // when the entity has no subsidies), so the hooks render an empty state.
  "agri-payload": async (dbRows, q) => {
    const kind = s(q, "kind");
    if (!kind) return { status: 400, body: { error: "missing kind" } };
    const key = s(q, "key"); // '' for the overview singleton
    const rows = await dbRows(
      "SELECT payload FROM agri_payloads WHERE kind = $1 AND key = $2",
      [kind, key],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.payload ?? null };
  },
  // НЗОК per-hospital БМП payments — latest-period snapshot for the health-pack
  // tile (was data/budget/nzok/hospital_payments.json). No param. Degrades to
  // null (not 500) until migration 045 reaches this DB.
  "nzok-hospital-payments": async (dbRows) => {
    const rows = await dbRows(
      "SELECT nzok_hospital_payments_latest() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // НЗОК reimbursement for one company (its ЛЗ facilities summed) → the
  // reimbursement tile on /company/:eik. null when the EIK has no matched НЗОК
  // payments (or migration 045 not yet applied).
  "nzok-hospital-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows("SELECT nzok_hospital_reimbursement_by_eik($1) AS r", [
      eik,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // НЗОК hospital-payment momentum — national monthly series + latest-YTD vs
  // same-month-prior-year, per facility. The time dimension for the "Динамика"
  // tile. No param. null until migration 045+047 reach this DB.
  "nzok-hospital-trends": async (dbRows) => {
    const rows = await dbRows(
      "SELECT nzok_hospital_payments_trends() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One company's spend-growth percentile among all hospitals → the percentile
  // badge on /company/:eik. null when the EIK isn't a matched hospital, lacks a
  // prior-year figure, or sits below the ranking base floor (or migration 047 not
  // yet applied).
  "nzok-hospital-momentum-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows(
      "SELECT nzok_hospital_momentum_by_eik($1) AS r",
      [eik],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
};

module.exports = { DB_ROUTES };
