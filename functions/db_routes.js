// Shared /api/db route table — ONE definition consumed by both the production
// Cloud Function (functions/index.js) and the Vite dev plugin (vite/db-api.ts),
// so dev == prod by construction and a route added here ships to both.
//
// Every handler is (dbRows, query) => Promise<{ status?, body }>, where
// `dbRows(sql, params)` is the caller's query fn (Cloud SQL pool or dev pool).
// All values are bound parameters; identifiers never come from the client.

const { runDbTable, runDbFacets } = require("./db_table.js");

const clampInt = (v, def, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : def;
};

const s = (q, k) => String(q[k] || "").trim();
const orNull = (q, k) => s(q, k) || null;

// Single contract by key → ProcurementContract shape (camelCased).
const CONTRACT_SQL = `
  SELECT key, ocid, tag, date, date_signed AS "dateSigned",
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
         category, bundle_uuid AS "bundleUuid", source_url AS "sourceUrl"
  FROM contracts WHERE key = $1 LIMIT 1`;

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
    const people = await dbRows(
      `SELECT o.name, count(DISTINCT o.uic) AS companies
       FROM tr_officers o
       WHERE o.name_fold %> translit_bg_latin($1)
         AND (SELECT bool_and(tok <% o.name_fold)
              FROM unnest(string_to_array(translit_bg_latin($1),' ')) tok WHERE tok<>'')
       GROUP BY o.name
       ORDER BY companies DESC, length(o.name)
       LIMIT 50`,
      [term],
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
    ] = await Promise.all([
      dbRows(
        "SELECT uic, name, legal_form, seat, status, funds_amount, funds_currency FROM tr_companies WHERE uic = $1",
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
        `SELECT contract_number, title, program_name, total_eur, paid_eur, status
         FROM fund_projects WHERE beneficiary_eik = $1
         ORDER BY total_eur DESC NULLS LAST LIMIT 6`,
        [eik],
      ),
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
  async tenders(dbRows, q) {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const limit = clampInt(q.limit, 25, 1, 200);
    const [summary, recent] = await Promise.all([
      dbRows("SELECT * FROM tenders_buyer_summary($1)", [eik]),
      dbRows("SELECT * FROM tenders_by_buyer($1, $2)", [eik, limit]),
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
    const rows = await dbRows("SELECT tender_detail($1, $2) AS r", [
      unp || null,
      ocid || null,
    ]);
    return { body: rows[0]?.r ?? { tender: null, awards: [] } };
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
    const eik = s(q, "eik");
    if (!division || !eik)
      return { status: 400, body: { error: "missing division or eik" } };
    const rows = await dbRows("SELECT sector_peers($1, $2) AS r", [
      division,
      eik,
    ]);
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
    const rows = await dbRows(CONTRACT_SQL, [key]);
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
    const rows = await dbRows("SELECT procurement_by_settlement($1, $2) AS r", [
      orNull(q, "from"),
      orNull(q, "to"),
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
    const rows = await dbRows("SELECT procurement_overview($1, $2) AS r", [
      orNull(q, "from"),
      orNull(q, "to"),
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // Full "see all" rankings (top contractors / awarders / MPs / officials),
  // window-scoped [from, to) or full corpus — the big-list sibling of
  // procurement-overview.
  "procurement-rankings": async (dbRows, q) => {
    const rows = await dbRows("SELECT procurement_rankings($1, $2) AS r", [
      orNull(q, "from"),
      orNull(q, "to"),
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // Consolidated client-side risk-scorer indexes (debarred register,
  // awarder→contractor concentration pairs, MP/official-connected EIK sets,
  // per-CPV-division competition baseline) — one payload, corpus-scoped.
  "procurement-risk-indexes": async (dbRows) => {
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
    // SECURITY: `me`/`other` are spliced into SQL as identifiers — they MUST
    // stay this fixed two-branch ternary; never derive them from client text.
    const entries = await dbRows(
      `WITH mine AS (
         SELECT ${other}_eik AS eik, ${other}_name AS name, tag,
                amount, currency, amount_eur
         FROM contracts
         WHERE ${me}_eik = $1 AND ${other}_eik IS NOT NULL AND ${other}_eik <> ''
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
      [eik],
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
      // SECURITY: `me`/`other` are spliced into SQL — they MUST stay this
      // fixed two-branch ternary; never derive them from client text.
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
  // The MPs / officials declared as officers/owners of one contractor — the
  // "connected people" chips on contract/company pages.
  "company-politicians": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const entries = await dbRows(
      `SELECT politician, ref, kind, role, total_eur AS "totalEur"
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
};

module.exports = { DB_ROUTES };
