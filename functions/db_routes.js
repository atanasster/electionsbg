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
// Every column is qualified `c.` because both queries LEFT JOIN tenders `t`
// (below), and ocid/cpv/currency/eu_program exist on both tables — unqualified
// they'd be ambiguous.
const CONTRACT_COLS = `
  c.key, c.ocid, c.tag, c.date, c.date_signed AS "dateSigned",
  c.awarder_eik AS "awarderEik", c.awarder_name AS "awarderName",
  c.awarder_region AS "awarderRegion",
  c.contractor_eik AS "contractorEik", c.contractor_eik_full AS "contractorEikFull",
  c.contractor_name AS "contractorName",
  c.amount, c.currency, c.amount_eur AS "amountEur",
  c.signing_amount_eur AS "signingAmountEur", c.title, c.cpv,
  c.procurement_method AS "procurementMethod",
  c.procurement_method_rationale AS "procurementMethodRationale",
  c.number_of_tenderers AS "numberOfTenderers",
  CASE WHEN c.eu_funded IS NULL THEN NULL ELSE c.eu_funded = 1 END AS "euFunded",
  c.eu_program AS "euProgram",
  c.tender_period_start_date AS "tenderPeriodStartDate",
  c.tender_period_end_date AS "tenderPeriodEndDate",
  c.category, c.bundle_uuid AS "bundleUuid", c.source_url AS "sourceUrl",
  c.lot_name AS "lotName",
  c.joint_kind AS "jointKind", c.consortium_role AS "consortiumRole",
  c.consortium_eik AS "consortiumEik", c.consortium_full_eur AS "consortiumFullEur"`;
// The procedure's PROGNOZA (estimated value) + поръчки source-day provenance,
// from the УНП-matched tender (tenders.unp is the PK → single-row seek). NULL for
// the ~49% of contracts with no matching tender — the UI degrades to two bases.
const TENDER_COLS = `
  t.estimated_value_eur AS "estimatedValueEur",
  t.source_url AS "tenderSourceUrl",
  t.source_day AS "tenderSourceDay"`;
const CONTRACT_SQL = `
  SELECT ${CONTRACT_COLS}, ${TENDER_COLS},
         c.has_appeal AS "hasAppeal", c.appeal_upheld AS "appealUpheld"
  FROM contracts_list c LEFT JOIN tenders t ON c.unp = t.unp
  WHERE c.key = $1 LIMIT 1`;
// Fallback for a DB predating migration 042 (contracts_list missing → 42P01):
// serve the contract without the appeal fields rather than 500 the whole page.
const CONTRACT_SQL_BASE = `
  SELECT ${CONTRACT_COLS}, ${TENDER_COLS}
  FROM contracts c LEFT JOIN tenders t ON c.unp = t.unp
  WHERE c.key = $1 LIMIT 1`;

// Degrade to "no appeals" ONLY for the missing-migration case (42883 =
// undefined_function): until 042 reaches this DB the appeals tile stays empty
// instead of 500-ing the whole tender page. Any other error still propagates.
const appealsOrEmpty = (e) =>
  e?.code === "42883" ? [{ r: [] }] : Promise.reject(e);

// Degrade a dedicated route to an empty result when its migration hasn't reached
// this DB yet — 42883 (undefined_function) OR 42P01 (undefined_table) — instead
// of hard-500-ing on a functions-before-migration deploy. Real errors propagate.
const missingMigrationEmpty = (e) =>
  e?.code === "42883" || e?.code === "42P01" ? [{ r: [] }] : Promise.reject(e);

// Same missing-migration degradation, but yields a bare `[]` — for routes that
// `return { body: rows }` directly (arrays of rows) rather than unwrapping
// `rows[0].r`. The `[{r:[]}]` sentinel would otherwise be served AS the array
// (e.g. price-history's fast path sees length 1 and returns it as the series;
// price-verdict returns `{r:[]}` and the tile computes NaN%).
const missingMigrationRows = (e) =>
  e?.code === "42883" || e?.code === "42P01" ? [] : Promise.reject(e);

// "Шльокавица" — best-effort Latin→Cyrillic phonetic transliteration so a user
// typing on a Latin keyboard ("kafe", "sirene", "mlyako") matches the Cyrillic
// product titles. Greedy digraph pass (sht/sh/ch/zh/ts/yu/ya/yo) then single
// letters; Cyrillic and unmapped characters pass through unchanged, so a query
// already in Cyrillic comes back identical. Ambiguous by nature (c→ц, y→й) — the
// trigram similarity ranking downstream absorbs the imperfection.
const LAT2CYR_DIGRAPHS = [
  ["sht", "щ"],
  ["sh", "ш"],
  ["ch", "ч"],
  ["zh", "ж"],
  ["ts", "ц"],
  ["yu", "ю"],
  ["ya", "я"],
  ["yo", "йо"],
];
const LAT2CYR = {
  a: "а",
  b: "б",
  v: "в",
  g: "г",
  d: "д",
  e: "е",
  z: "з",
  i: "и",
  j: "ж",
  k: "к",
  l: "л",
  m: "м",
  n: "н",
  o: "о",
  p: "п",
  r: "р",
  s: "с",
  t: "т",
  u: "у",
  f: "ф",
  h: "х",
  c: "ц",
  y: "й",
  w: "в",
  x: "кс",
  q: "к",
};
const latinToCyrillic = (str) => {
  const lower = String(str).toLowerCase();
  let out = "";
  for (let i = 0; i < lower.length; ) {
    const digraph = LAT2CYR_DIGRAPHS.find(([lat]) => lower.startsWith(lat, i));
    if (digraph) {
      out += digraph[1];
      i += digraph[0].length;
      continue;
    }
    out += LAT2CYR[lower[i]] ?? lower[i];
    i += 1;
  }
  return out;
};

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
      awarderAllTime,
      fundProjects,
      ngoDetails,
      awarderKindex,
      ngoFunding,
      awarderRiskGrade,
      supplierRiskGrade,
      corpusName,
      subsidies,
      retailChain,
      ngoSignals,
      ngoBoardLinks,
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
      // `relations` (the full connections jsonb) rides along so the shared
      // political-links tile can render "(former)" / "declared stake N%" /
      // role labels without a second round-trip to the company-politicians route.
      dbRows(
        "SELECT politician, ref, kind, role, relations, total_eur FROM company_politicians WHERE eik = $1 ORDER BY total_eur DESC NULLS LAST LIMIT 200",
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
      // DELIBERATELY UNSCOPED: "is this an awarder at all, in any period?".
      // Everything else here is windowed by from/to, so an entity whose only
      // activity sits outside the selected scope looked like a blank page with
      // no scope control — stranding the reader with no way back to "all"
      // (exactly what the hadAwarder latch was meant to prevent, but the latch
      // never fires if you LAND on an empty window). Cheap: bitmap index scan
      // on idx_contracts_awarder (~cost 338).
      dbRows(
        `SELECT count(*)::int AS contracts,
                COALESCE(SUM(amount_eur), 0)::float8 AS total_eur
         FROM contracts WHERE awarder_eik = $1 AND tag = 'contract'`,
        [eik],
      ),
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
      // Retail-chain block: if this EIK is a КЗП price-monitored chain, its
      // comparable-basket cost + rank among chains (from the precomputed `chains`
      // payload, ~110 rows). Returns no row for a non-chain. Drives the reciprocal
      // "this company is a retail chain" tile → /consumption/chain/:eik. Guarded on
      // the missing-migration case (price_payloads absent pre-048).
      dbRows(
        `WITH arr AS (
           SELECT payload->'national' AS n FROM price_payloads
            WHERE kind = 'chains' AND key = ''
         ),
         ranked AS (
           SELECT (e->>'eik') AS eik,
                  (e->>'chain') AS chain,
                  (e->>'basket')::float8 AS basket,
                  (e->>'nPriced')::int AS n_priced,
                  row_number() OVER (ORDER BY (e->>'basket')::float8 ASC) AS rank,
                  count(*) OVER () AS total
             FROM arr, jsonb_array_elements(arr.n) e
         )
         SELECT chain, basket, n_priced, rank::int, total::int FROM ranked WHERE eik = $1`,
        [eik],
      ).catch((e) => (e?.code === "42P01" ? [] : Promise.reject(e))),
      // Per-NGO public-interest signal set (migration 080). ngo_signal_row is
      // entity-class-agnostic, so a commercial EIK with contracts/funds also gets
      // a non-empty array — the NGO page only RENDERS it for NGO classes. Guarded
      // on the missing-migration case (42883) so the page still renders pre-080.
      dbRows("SELECT ngo_signals_for($1) AS r", [eik]).catch((e) =>
        e?.code === "42883" ? [] : Promise.reject(e),
      ),
      // Politicians / officials / magistrates on this NGO's governing body
      // (migration 080). HIGH-confidence ONLY — medium (namesake company_count
      // 2–3) is deliberately withheld from the public page (a name coincidence is
      // too likely to name a real person). Empty for non-NGOs / pre-080.
      dbRows(
        `SELECT person, ref, kind, role, position, confidence FROM ngo_board_links
         WHERE eik = $1 AND confidence = 'high' ORDER BY person LIMIT 50`,
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
        awarderAllTime: awarderAllTime[0] ?? null,
        fundProjects,
        ngoDetails: ngoDetails[0] ?? null,
        awarderKindex: awarderKindex[0]?.r ?? null,
        ngoFunding: ngoFunding[0]?.r ?? null,
        awarderRiskGrade: awarderRiskGrade[0]?.r ?? null,
        supplierRiskGrade: supplierRiskGrade[0]?.r ?? null,
        corpusName: corpusName[0]?.name ?? null,
        subsidies: subsidies[0]?.payload ?? null,
        retailChain: retailChain[0] ?? null,
        ngoSignals: ngoSignals[0]?.r ?? null,
        ngoBoardLinks,
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
    // NGOs carrying ≥1 signal runs as its OWN guarded query: a `FROM ngo_signals`
    // reference is resolved at parse time, so an in-SQL to_regclass CASE can't
    // gate it — a missing (42P01) or unpopulated (55000) matview would 500 the
    // whole card. Mirror the company route's per-source .catch degradation.
    const [rows, signalRows] = await Promise.all([
      dbRows(
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
      ),
      dbRows(
        "SELECT count(*)::int AS n FROM ngo_signals WHERE signal_count > 0",
      ).catch((e) =>
        ["42P01", "55000"].includes(e?.code) ? [{ n: 0 }] : Promise.reject(e),
      ),
    ]);
    return {
      body: { ...(rows[0] ?? {}), ngos_with_signal: signalRows[0]?.n ?? 0 },
    };
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
      e?.code === "42P01"
        ? dbRows(CONTRACT_SQL_BASE, [key])
        : Promise.reject(e),
    );
    return { body: { contract: rows[0] ?? null } };
  },
  // "How normal is this procurement?" — one contract positioned in its cohort of
  // similar procurements (adaptive-CPV-prefix, era-matched) across value, bidder
  // count, procedure mix, and supplier concentration. Descriptive context, not a
  // verdict — the companion to the per-contract CRI. Degrades to an empty payload
  // (missingMigrationEmpty → [], no cohort/concentration) on a DB predating
  // migration 063; both consumers treat that like the no-data case.
  "procurement-normalcy": async (dbRows, q) => {
    const key = s(q, "key");
    if (!key) return { status: 400, body: { error: "missing key" } };
    // Fast path: the precomputed matview (064) — one PK seek (~0.1ms) vs the live
    // function's ~290ms warm / 6-12s cold big-division scan. Fall back to the
    // live function for a key not yet in the cache (freshly ingested between
    // refreshes) or a DB predating the matview.
    try {
      const c = await dbRows(
        "SELECT payload FROM procurement_normalcy_cache WHERE key = $1",
        [key],
      );
      if (c[0]?.payload !== undefined) return { body: c[0].payload };
    } catch {
      // matview absent — fall through to the live computation
    }
    const rows = await dbRows("SELECT procurement_normalcy($1) AS r", [
      key,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // "How typical is this tender?" — cohort-distribution payload for one tender
  // (067). Cache-first PK seek on УНП; live fn fallback for a tender not yet in
  // the matview (freshly ingested) or a DB predating the migration.
  "tender-normalcy": async (dbRows, q) => {
    const unp = s(q, "unp");
    if (!unp) return { status: 400, body: { error: "missing unp" } };
    try {
      const c = await dbRows(
        "SELECT payload FROM tender_normalcy_cache WHERE unp = $1",
        [unp],
      );
      if (c[0]?.payload !== undefined) return { body: c[0].payload };
    } catch {
      // matview absent — fall through to the live computation
    }
    const rows = await dbRows("SELECT tender_normalcy($1) AS r", [unp]).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? null };
  },
  // CPV catalogue — distinct named CPV codes (from the tenders feed's cpv_desc,
  // the only place we carry code→name beyond the 2-digit division titles). Feeds
  // the searchable CPV filter on the contracts browser (~3.6k codes, cached).
  "cpv-catalog": async (dbRows) => {
    const rows = await dbRows(
      `SELECT DISTINCT ON (cpv) cpv, cpv_desc AS desc
         FROM tenders
        WHERE cpv IS NOT NULL AND cpv_desc IS NOT NULL AND btrim(cpv_desc) <> ''
        ORDER BY cpv, length(cpv_desc) DESC`,
      [],
    ).catch(missingMigrationRows);
    return { body: rows };
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
  // Cross-corpus leaderboard — companies that appear in BOTH the procurement
  // (ЗОП) and EU-funds (ИСУН) corpora, ranked by combined public money. All-time
  // only (funds aren't date-windowed); no from/to. Served from the load-time
  // cache matview (077), falling through to the live function when it is empty
  // or absent, and to null on a DB predating the migration.
  "dual-corpus-rankings": async (dbRows) => {
    try {
      const c = await dbRows("SELECT r FROM dual_corpus_rankings_cache", []);
      if (c[0]?.r) return { body: c[0].r };
    } catch {
      // matview absent — fall through to the live computation
    }
    const rows = await dbRows("SELECT dual_corpus_rankings() AS r", []).catch(
      (e) =>
        e?.code === "42883" || e?.code === "42P01"
          ? [{ r: null }]
          : Promise.reject(e),
    );
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
      e?.code === "42883" || e?.code === "42P01" ? [] : Promise.reject(e),
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
              amount, currency, amount_eur AS "amountEur",
  signing_amount_eur AS "signingAmountEur", title, cpv,
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
  // Consolidated per-awarder rollup over a SET of EIKs — one grouped aggregate
  // (eik, contractCount, totalEur) for a sector browse pack's context strip,
  // instead of fanning out over awarder-contracts and downloading every row for
  // 26+ operators. Windowed [from, to) with sargable COALESCE bounds so the
  // date guard doesn't defeat the awarder-eik index.
  "awarder-group-rollup": async (dbRows, q) => {
    const eiks = s(q, "eiks")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => /^\d{9,13}$/.test(e))
      .slice(0, 300);
    if (!eiks.length) return { status: 400, body: { error: "missing eiks" } };
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    const operators = await dbRows(
      `SELECT awarder_eik AS eik,
              count(*)::int AS "contractCount",
              round(sum(amount_eur))::double precision AS "totalEur",
              count(*) FILTER (WHERE number_of_tenderers IS NOT NULL)::int
                AS "bidKnownN",
              count(*) FILTER (WHERE number_of_tenderers = 1)::int
                AS "singleBidN"
       FROM contracts
       WHERE awarder_eik = ANY($1) AND tag = 'contract'
         AND date >= COALESCE($2, '')
         AND date <  COALESCE($3, '99999999')
       GROUP BY awarder_eik
       ORDER BY sum(amount_eur) DESC NULLS LAST, awarder_eik`,
      [eiks, from, to],
    );
    return { body: { operators } };
  },
  // FULL sector-pack model over a SET of EIKs in ONE aggregate — the server-side
  // replacement for the 25+-request client fan-out (awarder-contracts × each
  // budget unit) that the Води/ВСС/Отбрана/НОИ/НЗОК/Култура packs used to run.
  // Returns the compact aggregates buildAwarderModelFromAggregates() folds back
  // into the identical AwarderModel (CPV→category classification stays in TS).
  // Windowed [from, to) with sargable COALESCE bounds. See 061_awarder_group_model.
  "awarder-group-model": async (dbRows, q) => {
    const eiks = s(q, "eiks")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => /^\d{9,13}$/.test(e))
      .slice(0, 300);
    if (!eiks.length) return { status: 400, body: { error: "missing eiks" } };
    const rows = await dbRows("SELECT awarder_group_model($1, $2, $3) AS r", [
      eiks,
      orNull(q, "from"),
      orNull(q, "to"),
    ]);
    return { body: rows[0]?.r ?? null };
  },
  // Top-N contracts by € across a SET of EIKs — the award-level tile's input
  // (e.g. the МВР pack's "biggest contracts"). Server-side ORDER BY amount_eur +
  // LIMIT so the client gets only the rows it renders, instead of fanning out over
  // awarder-contracts and downloading every full corpus (МВР's 4 big buyers were
  // ~3.5 MB for 8 rows). Windowed [from, to) with sargable COALESCE bounds; the
  // awarder_eik + amount_eur indexes carry it.
  "awarder-group-top-contracts": async (dbRows, q) => {
    const eiks = s(q, "eiks")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => /^\d{9,13}$/.test(e))
      .slice(0, 300);
    if (!eiks.length) return { status: 400, body: { error: "missing eiks" } };
    const limit = clampInt(q.limit, 8, 1, 50);
    const from = orNull(q, "from");
    const to = orNull(q, "to");
    const contracts = await dbRows(
      `SELECT key, date,
              contractor_eik AS "contractorEik", contractor_name AS "contractorName",
              amount_eur AS "amountEur", title,
              number_of_tenderers AS "numberOfTenderers",
              CASE WHEN eu_funded IS NULL THEN NULL ELSE eu_funded = 1 END AS "euFunded"
       FROM contracts
       WHERE awarder_eik = ANY($1) AND tag = 'contract' AND amount_eur IS NOT NULL
         -- Exclude €0 consortium member rows (migration 087) — the carrier row
         -- carries the joint value into this "top contracts" list.
         AND consortium_role IS DISTINCT FROM 'member'
         AND date >= COALESCE($2, '')
         AND date <  COALESCE($3, '99999999')
       ORDER BY amount_eur DESC NULLS LAST, key
       LIMIT $4`,
      [eiks, from, to, limit],
    );
    return { body: { contracts } };
  },
  // EU-funds (ИСУН) rollup over a SET of EIKs — per-beneficiary contracted/paid
  // from the already-rolled fund_beneficiaries table (one row per EIK). Not
  // date-windowed: EU-funds figures are programme-period lifetime totals, not a
  // parliament slice. Feeds the water pack's EU-investment tile.
  "awarder-funds-rollup": async (dbRows, q) => {
    const eiks = s(q, "eiks")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => /^\d{9,13}$/.test(e))
      .slice(0, 300);
    if (!eiks.length) return { status: 400, body: { error: "missing eiks" } };
    const operators = await dbRows(
      `SELECT eik,
              round(contracted_eur)::double precision AS "contractedEur",
              round(paid_eur)::double precision AS "paidEur",
              contract_count::int AS "projectCount"
       FROM fund_beneficiaries
       WHERE eik = ANY($1)
       ORDER BY contracted_eur DESC NULLS LAST, eik`,
      [eiks],
    );
    return { body: { operators } };
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
           -- Exclude €0 consortium member rows (migration 087): the joint value
           -- sits on the carrier entity, so member rows would list a counterparty
           -- at €0. Participation is surfaced separately on the company page.
           AND consortium_role IS DISTINCT FROM 'member'
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
  // see docs/plans/procurement-dashboard-redesign-v1.md for the checklist. The
  // ЕВРОФОНДОВЕ group additionally needs pg/086_search_fund_projects.sql (applied
  // by load_funds_pg); until then its query degrades to [] via the allSettled.
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
      // ЕВРОФОНДОВЕ · ИСУН projects (§4.1) — degrades to [] on a DB predating
      // migration 086 via the allSettled below. Only the tile-consumed columns
      // (the dossier's ИСУН block fetches full fund rows by contract_number).
      dbRows(
        `SELECT contract_number AS "contractNumber", title,
                beneficiary_eik AS "beneficiaryEik",
                beneficiary_name AS "beneficiaryName",
                program_name AS "programName",
                total_eur AS "totalEur"
         FROM search_fund_projects($1, $2)`,
        [term, lim],
      ),
    ]);
    const [companies, awarders, contracts, tenders, funds] = settled.map((r) =>
      r.status === "fulfilled" ? r.value : [],
    );
    // Total matches per "see all" group, so the dropdown can show "6 of N" and
    // the preview cap reads as a preview, not the whole result. Only paid when
    // the preview is actually capped (length === lim ⇒ there may be more), and
    // bounded to 100 so a very common word ("ремонт", ~35k hits) stays cheap —
    // the UI renders 100 as "99+". Mirrors the search fns' predicate (title/
    // subject FTS prefix-AND OR trigram fallback over the fold).
    const boundedTotal = async (table, foldCol, extra, shown) => {
      if (shown < lim) return shown; // preview wasn't capped → we have them all
      const rows = await dbRows(
        `SELECT count(*)::int AS n FROM (
           SELECT 1 FROM ${table}
           WHERE ${extra}
             AND (to_tsvector('simple', ${foldCol}) @@ fold_prefix_tsquery($1)
                  OR ${foldCol} %> translit_bg_latin($1))
           LIMIT 100) x`,
        [term],
      );
      return Number(rows[0]?.n ?? shown);
    };
    const [contractsTotal, tendersTotal] = await Promise.all([
      boundedTotal(
        "contracts",
        "title_fold",
        "tag = 'contract' AND title IS NOT NULL AND title <> ''",
        contracts.length,
      ),
      boundedTotal(
        "tenders",
        "subject_fold",
        "subject IS NOT NULL AND subject <> ''",
        tenders.length,
      ),
    ]);
    return {
      body: {
        companies,
        awarders,
        contracts,
        tenders,
        funds,
        contractsTotal,
        tendersTotal,
      },
    };
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
    // Load-time cache matview (044): the live function LEFT JOINs kzk_appeals →
    // tenders (126k) and has spiked to 113s on Cloud SQL under a bad plan / cold
    // cache. Serve the precomputed row; fall through to the live function only
    // when the matview is absent (older DB).
    try {
      const c = await dbRows("SELECT r FROM kzk_appeals_summary_cache", []);
      if (c[0]?.r) return { body: c[0].r };
    } catch {
      // matview absent — fall through to the live computation
    }
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
  // ── Schools / education serving (school_payloads, migration 055) ─────────────
  // The 'directory' blob (key '') is the whole /education dataset with the SES +
  // value-added verdicts precomputed in the loader — one PK seek, ~150 KB, vs the
  // 1.25 MB raw index the client used to fetch and regress itself.
  "education-payload": async (dbRows, q) => {
    const kind = s(q, "kind") || "directory";
    const key = s(q, "key"); // '' for the directory singleton
    const rows = await dbRows(
      "SELECT payload FROM school_payloads WHERE kind = $1 AND key = $2",
      [kind, key],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.payload ?? null };
  },
  // A school's own /company/:eik (or /awarder/:eik) page → its report card. Reads
  // the RELATIONAL schools table via idx_schools_eik — the entity-graph join
  // (schools.eik = awarder EIK), not the directory blob — so the company page can
  // surface "this EIK is a school" and link to /school/:id. One EIK can carry
  // several НЕИСПУО units (stages sharing a legal entity); pick the most-populous
  // latest cohort. null when the EIK isn't a matched school.
  "school-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { body: null };
    const rows = await dbRows(
      `SELECT id, name, obshtina, oblast, latest_year AS "latestYear",
              latest_bel AS "latestBel", latest_n AS "latestN"
         FROM schools
        WHERE eik = $1
        ORDER BY latest_n DESC NULLS LAST, id
        LIMIT 1`,
      [eik],
    ).catch(missingMigrationRows);
    return { body: rows[0] ?? null };
  },
  // Schools in one município ranked by their latest score in a subject — the
  // `schoolScores` AI tool. Reads the RELATIONAL school_scores fact table (which
  // carries every subject: dzi_bel/dzi_math/nvo_bel/nvo_math per year), so it
  // supports subject selection the БЕЛ-centric directory blob can't, and drops
  // the tool's old 1.25 MB /schools/index.json fetch. LATERAL picks each school's
  // latest year for the chosen subject.
  "education-muni-scores": async (dbRows, q) => {
    const obshtina = s(q, "obshtina");
    const subject = s(q, "subject") || "dzi_bel";
    if (!obshtina) return { body: [] };
    const rows = await dbRows(
      `SELECT sc.name, sc.address, f.year, f.value, f.n
         FROM schools sc
         JOIN LATERAL (
           SELECT year, value, n FROM school_scores
            WHERE school_id = sc.id AND subject = $2
            ORDER BY year DESC LIMIT 1
         ) f ON true
        WHERE sc.obshtina = $1
        ORDER BY f.value DESC, sc.name`,
      [obshtina, subject],
    ).catch(missingMigrationRows);
    return { body: rows };
  },
  // ── КЗП „Колко струва" prices (migration 048) ───────────────────────────────
  // Every dashboard payload the old data/prices/*.json tree served, keyed by
  // (kind, key): 'index'|'ranking'|'chains'|'dict' (key ''), 'place' (key =
  // ekatte), 'chains-muni' (key = obshtina). One PK seek → the jsonb.
  "price-payload": async (dbRows, q) => {
    const kind = s(q, "kind");
    if (!kind) return { status: 400, body: { error: "missing kind" } };
    const key = s(q, "key");
    const rows = await dbRows(
      "SELECT payload FROM price_payloads WHERE kind = $1 AND key = $2",
      [kind, key],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.payload ?? null };
  },

  // Free-text search over the ~80k-product catalogue (trigram index).
  // Retired products (chain_count = 0) keep their slug so old URLs resolve, but
  // must never surface in search.
  "price-search": async (dbRows, q) => {
    const term = s(q, "q");
    if (term.length < 2) return { body: [] };
    // Also search a Latin→Cyrillic ("шльокавица") transliteration so "kafe"
    // finds "кафе". `cyr` equals `term` when the query is already Cyrillic, so
    // the extra ILIKE/similarity is a no-op there.
    const cyr = latinToCyrillic(term);
    // Escape LIKE metacharacters (%, _, \) so a stray `%` in the term doesn't
    // match everything — the ILIKE is a prefilter, not a wildcard search.
    // $1/$4 stay the RAW terms for similarity() (trigram treats them as literals).
    const esc = (t) => "%" + t.replace(/[\\%_]/g, "\\$&") + "%";
    const rows = await dbRows(
      // Blend match quality with popularity: a term like "лаваца" matches a
      // one-chain "КАФЕ ЛАВАЦА КГ" and the 7-chain "КАФЕ ЛАВАЦА 1КГ КУАЛИТА
      // РОСА ЗЪРНА" equally on trigram similarity, but the shopper means the
      // latter. Weighting similarity by ln(chain_count) surfaces the product
      // people actually buy without letting a loose match on a popular product
      // jump a tight one. The trgm index still drives the ILIKE prefilter.
      `SELECT slug, title, pid, brand, net_qty, net_unit, chain_count,
              current_min_eur, pct_since_euro
         FROM price_products
        WHERE chain_count > 0
          AND (title ILIKE $2 ESCAPE '\\' OR title ILIKE $3 ESCAPE '\\')
        ORDER BY GREATEST(similarity(title, $1), similarity(title, $4))
                   * ln(chain_count + 2) DESC,
                 chain_count DESC, slug COLLATE "C"
        LIMIT 20`,
      [term, esc(term), esc(cyr), cyr],
    ).catch(missingMigrationRows);
    return { body: rows };
  },

  // One product: the cross-chain ladder, cheapest first.
  // Current prices come from price_current — NEVER from price_facts, whose open
  // runs include every delisted SKU (36% phantom over-count). Design §3.2.
  "price-product": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { status: 400, body: { error: "missing slug" } };
    const ekatte = s(q, "ekatte"); // optional: narrow the ladder to one place
    // Unit-outlier guard (mirrors build_product_days.ts): for a per-kg product,
    // drop store-facts below half its cross-store median before ranking chains,
    // so a per-piece listing (a single banana at €0.76) is not shown as the
    // cheapest chain. Packaged goods keep every row. The median is over the whole
    // (place-scoped) store panel, not the per-chain mins, so one small chain
    // cannot move the floor. Ranking-only: it never hides a chain's real per-kg
    // price, only spurious per-piece values.
    const rows = await dbRows(
      `WITH p AS (SELECT * FROM price_products WHERE slug = $1),
            panel AS (
              SELECT k.eik, ch.name AS chain, pc.price_eur, pc.promo_eur,
                     pc.store_id, st.label AS store, st.settlement, p.unit_priced
                FROM p
                JOIN price_skus    k  ON k.product_id = p.product_id
                JOIN price_current pc ON pc.sku_id = k.sku_id
                JOIN price_stores  st ON st.store_id = pc.store_id
                JOIN price_chains  ch ON ch.eik = k.eik
               WHERE ($2 = '' OR st.ekatte = $2)
            ),
            med AS (
              SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price_eur) AS m
                FROM panel
            )
       SELECT jsonb_build_object(
         'product', (SELECT to_jsonb(p) FROM p),
         'chains', COALESCE((
            SELECT jsonb_agg(to_jsonb(x)
                     ORDER BY COALESCE(x.promo_eur, x.price_eur), x.eik COLLATE "C")
              FROM (SELECT panel.eik,
                           MIN(panel.chain COLLATE "C") AS chain,
                           -- ONE store per chain — the cheapest by EFFECTIVE
                           -- price (promo wins) — and every field of the row
                           -- comes from that same store: regular, promo, label,
                           -- settlement. Taking MIN(price_eur) and
                           -- MIN(promo_eur) independently paired a promo from
                           -- one store with a regular from another, so the UI's
                           -- €/kg and "+X €" gap described no real shelf.
                           (array_agg(panel.price_eur
                              ORDER BY COALESCE(panel.promo_eur, panel.price_eur),
                                       panel.store_id))[1] AS price_eur,
                           (array_agg(panel.promo_eur
                              ORDER BY COALESCE(panel.promo_eur, panel.price_eur),
                                       panel.store_id))[1] AS promo_eur,
                           COUNT(DISTINCT panel.store_id) AS stores,
                           (array_agg(panel.store COLLATE "C"
                              ORDER BY COALESCE(panel.promo_eur, panel.price_eur),
                                       panel.store_id))[1] AS store,
                           (array_agg(panel.settlement COLLATE "C"
                              ORDER BY COALESCE(panel.promo_eur, panel.price_eur),
                                       panel.store_id))[1] AS settlement
                      FROM panel CROSS JOIN med
                     WHERE NOT panel.unit_priced OR panel.price_eur >= 0.5 * med.m
                     GROUP BY panel.eik) x), '[]'::jsonb)
       ) AS r`,
      [slug, ekatte],
    ).catch(missingMigrationEmpty);
    const r = rows[0]?.r;
    return { body: r?.product ? r : null };
  },

  // Per-product daily minimum since euro day.
  //
  // Two masks, both load-bearing. (1) A run only counts on days the SKU was
  // actually listed: `day BETWEEN k.first_seen AND k.last_seen`. Without it a
  // delisted SKU's open run drags its last price forward forever. (2) A day only
  // counts when the chain actually reported (price_chain_days) — a reporting gap
  // is a gap, never a flat line.
  "price-history": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { status: 400, body: { error: "missing slug" } };

    // Fast path: the prerendered head is materialized by `prices:product-days`.
    const hot = await dbRows(
      `SELECT d.day::text AS day, d.min_eur, d.min_promo_eur, d.chains
         FROM price_product_days d
         JOIN price_products p ON p.product_id = d.product_id
        WHERE p.slug = $1
        ORDER BY d.day`,
      [slug],
    ).catch(missingMigrationRows);
    if (hot.length) return { body: hot };

    // Long tail: expand the step function live. Cheap here — these products have
    // one or two SKUs. (The head would cost ~190k row-days and ~370ms, which is
    // exactly why it is precomputed.)
    //
    // st.eik is always k.eik — a SKU belongs to exactly one chain, verified zero
    // cross-chain facts — so no price_stores join is needed for the mask.
    // Unit-outlier guard mirrors build_product_days.ts: per-kg products drop
    // store-facts below half the day's cross-store median so a single per-piece
    // price cannot pin the min; packaged goods keep the raw min. (For a 1–2 SKU
    // tail product the half-median floor never bites — there is no panel.)
    const rows = await dbRows(
      `WITH p AS (SELECT product_id, unit_priced FROM price_products WHERE slug = $1),
            span AS (SELECT min(day) AS d0, max(day) AS d1 FROM price_grid_days),
            pd AS (
              SELECT d.day::date AS day, k.eik, f.price_eur, f.promo_eur,
                     (SELECT unit_priced FROM p) AS unit_priced
                FROM span
                CROSS JOIN generate_series(span.d0, span.d1, interval '1 day') AS d(day)
                JOIN price_skus  k ON k.product_id = (SELECT product_id FROM p)
                                  AND d.day::date BETWEEN k.first_seen AND k.last_seen
                JOIN price_facts f ON f.sku_id = k.sku_id
                                  AND f.valid_from <= d.day::date
                                  AND (f.valid_to IS NULL OR f.valid_to >= d.day::date)
                JOIN price_chain_days cd ON cd.day = d.day::date AND cd.eik = k.eik
            ),
            med AS (
              SELECT day, percentile_cont(0.5) WITHIN GROUP (ORDER BY price_eur) AS m
                FROM pd GROUP BY day
            )
       SELECT pd.day::text AS day,
              MIN(pd.price_eur)      AS min_eur,
              MIN(LEAST(pd.price_eur, COALESCE(pd.promo_eur, pd.price_eur))) AS min_promo_eur,
              COUNT(DISTINCT pd.eik) AS chains
         FROM pd JOIN med USING (day)
        WHERE NOT pd.unit_priced OR pd.price_eur >= 0.5 * med.m
        GROUP BY pd.day
        ORDER BY pd.day`,
      [slug],
    ).catch(missingMigrationRows);
    return { body: rows };
  },

  // "Did the euro raise prices?" — Croatia's Kretanje-cijena classification
  // against euro day, plus the FIFTH bucket the audit demanded: `no_baseline`
  // are products with no observation on the baseline day. Dropping them
  // understates the denominator; calling them unchanged fabricates a result.
  "price-verdict": async (dbRows) => {
    // Precomputed by build_payloads (kind='verdict') — an index-only PK seek,
    // not the full-table Parallel Seq Scan the live aggregate would run on
    // every /consumption/overview load. Falls back to the live aggregate if the
    // payload hasn't been built yet (e.g. between a schema change and a reload).
    const cached = await dbRows(
      `SELECT payload FROM price_payloads WHERE kind = 'verdict' AND key = ''`,
    ).catch(missingMigrationRows);
    if (cached[0]?.payload) return { body: cached[0].payload };
    const rows = await dbRows(
      `SELECT count(*) FILTER (WHERE pct_since_euro < -0.1)      AS cheaper,
              count(*) FILTER (WHERE pct_since_euro >  0.1)      AS dearer,
              count(*) FILTER (WHERE abs(pct_since_euro) <= 0.1) AS unchanged,
              count(*) FILTER (WHERE pct_since_euro IS NULL)     AS no_baseline,
              count(*)                                           AS total
         FROM price_products WHERE chain_count > 0`,
    ).catch(missingMigrationRows);
    return { body: rows[0] ?? null };
  },

  // Biggest movers since euro day, at product grain. Only cross-chain products,
  // so a single chain's private-label reprice cannot top the leaderboard.
  "price-movers": async (dbRows, q) => {
    const dir = s(q, "dir") === "down" ? "ASC" : "DESC";
    const rows = await dbRows(
      `SELECT slug, title, pid, chain_count, current_min_eur, pct_since_euro
         FROM price_products
        WHERE chain_count > 1 AND pct_since_euro IS NOT NULL
        ORDER BY pct_since_euro ${dir}, chain_count DESC, slug COLLATE "C"
        LIMIT 20`,
    ).catch(missingMigrationRows);
    return { body: rows };
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
    const rows = await dbRows(
      "SELECT nzok_hospital_reimbursement_by_eik($1) AS r",
      [eik],
    ).catch(missingMigrationEmpty);
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
    const rows = await dbRows("SELECT nzok_hospital_momentum_by_eik($1) AS r", [
      eik,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },

  // ЕЕОФ quarterly hospital financial + capacity indicators (МЗ, Наредба № 5 от
  // 2019), 2019-Q2 →. Latest quarter's national aggregates + the largest
  // hospitals. null until migration 051 reaches this DB.
  "nzok-hospital-financials": async (dbRows) => {
    const rows = await dbRows(
      "SELECT nzok_hospital_financials_latest() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One hospital's quarterly financial SERIES (debt, overdue debt, cost per
  // patient, occupancy, length of stay) → the financial-health strip on
  // /company/:eik. null when the EIK isn't a matched hospital.
  "nzok-financials-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows(
      "SELECT nzok_hospital_financials_by_eik($1) AS r",
      [eik],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },

  // Per-hospital drug UNIT PRICES (НЗОК Наредба 10 „Справка 5" / ПЛС2). Overview:
  // latest period, the volume floor, and the biggest overpay-vs-median rows.
  // Comparison is at PACK identity (Национален №), never at INN — pack size and
  // dosage form would otherwise drive the ratio. null until migration 052 lands.
  "nzok-drug-unit-prices": async (dbRows) => {
    const rows = await dbRows(
      "SELECT nzok_drug_unit_prices_overview() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // The monthly median/p25/p75 series for ONE pack — "is the gap widening or
  // closing?", the question a single-year corpus structurally cannot answer.
  "nzok-drug-pack-trend": async (dbRows, q) => {
    const nationalNo = s(q, "nationalNo");
    const nzokCode = s(q, "nzokCode");
    if (!nationalNo && !nzokCode)
      return { status: 400, body: { error: "missing nationalNo or nzokCode" } };
    const rows = await dbRows("SELECT nzok_drug_pack_trend($1, $2) AS r", [
      nationalNo,
      nzokCode,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One hospital's overpay-vs-median rows → the drug-price strip on /company/:eik.
  // Dispersion is NOT wrongdoing: volume discounts, delivery period and contract
  // terms all move a unit price. These are pointers for a closer look, and the
  // defensible claim is persistent dispersion over months, not one month's ratio.
  "nzok-drug-overpay-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows("SELECT nzok_drug_overpay_by_eik($1) AS r", [
      eik,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // НЗОК CLINICAL-ACTIVITY overview → the activity tile: national headline
  // (total cases, procedures, facilities), the monthly cases trend, the top
  // procedures by volume, and the pathway-internal cases-per-bed outlier
  // leaderboard. The outlier is a signpost, not a verdict (see 053_*.sql). No
  // param. Degrades to null when migration 053 is absent.
  "nzok-activities": async (dbRows) => {
    const rows = await dbRows(
      "SELECT nzok_activities_overview() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One hospital's case-mix → the case-mix strip on /company/:eik: its top
  // procedures by cases and its share of the national volume for each. This is
  // the DENOMINATOR that makes any per-patient figure interpretable.
  "nzok-activities-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows("SELECT nzok_activities_by_eik($1) AS r", [
      eik,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // Top hospitals by a transparent multi-signal risk index (drug overpay +
  // cases-per-bed outliers + overdue debt) → the "Риск по болници" tile on the
  // НЗОК health pack. Each row's components stay visible; rows link to /company.
  "nzok-hospital-risk": async (dbRows) => {
    const rows = await dbRows(
      "SELECT nzok_hospital_risk_ranking() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // Risk by drug (INN headline, packs nested) → the "Риск по лекарства" tile.
  "nzok-drug-risk": async (dbRows) => {
    const rows = await dbRows("SELECT nzok_drug_risk_by_inn() AS r", []).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? null };
  },
  // Drug-savings leaderboard (migration 055): national avoidable-overpay headline
  // + per-hospital ranking, framed as recoverable euros. A signpost, not a verdict.
  "nzok-drug-savings": async (dbRows) => {
    const rows = await dbRows(
      "SELECT nzok_drug_savings_overview() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // Per-INN QUARTERLY reimbursement trend (migration 066): national curve + the
  // top molecules' quarterly series — the multi-period drug view a one-year
  // corpus can't draw. No param.
  "nzok-drug-quarterly": async (dbRows) => {
    const rows = await dbRows(
      "SELECT nzok_drug_quarterly_overview() AS r",
      [],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One molecule's full quarterly series — the searchable picker drill-down.
  "nzok-drug-quarterly-by-inn": async (dbRows, q) => {
    const inn = s(q, "inn");
    if (!inn) return { status: 400, body: { error: "missing inn" } };
    const rows = await dbRows("SELECT nzok_drug_quarterly_by_inn($1) AS r", [
      inn,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One hospital's financial "report card" (migration 056): each ratio measure
  // vs the national median + the p40/p60 "around the median" band + percentile.
  "nzok-financials-measures-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows(
      "SELECT nzok_financials_measures_by_eik($1) AS r",
      [eik],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One measure's decile fan over time (migration 056): p10..p90 bands + median
  // per quarter, with the selected hospital's own value threaded through.
  "nzok-financials-measure-fan": async (dbRows, q) => {
    const measure = s(q, "measure");
    const eik = s(q, "eik");
    if (!measure) return { status: 400, body: { error: "missing measure" } };
    const rows = await dbRows(
      "SELECT nzok_financials_measure_fan($1, $2) AS r",
      [measure, eik ?? ""],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One hospital's ЕЕОФ reporting coverage (migration 058): which quarters are
  // present vs missing, so a reporting gap isn't misread as a spend drop.
  "nzok-financials-coverage-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows(
      "SELECT nzok_financials_coverage_by_eik($1) AS r",
      [eik],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // Pathway navigation WITH spend (migration 059): the by-procedure hospital list
  // plus the НРД list-price tariff and implied spend (cases × tariff) when tariffs
  // are loaded; priceEur/spendEur are null (volume-only) until then.
  "nzok-activity-by-procedure-spend": async (dbRows, q) => {
    const procedure = s(q, "procedure");
    if (!procedure)
      return { status: 400, body: { error: "missing procedure" } };
    const rows = await dbRows(
      "SELECT nzok_activity_by_procedure_spend($1) AS r",
      [procedure],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // Case-mix expected-vs-actual for one hospital (migration 059): expected Σ(list
  // tariff × cases) vs actual БМП paid, with tariff coverage. NULL until tariffs
  // are loaded (BG-egress ingest) — the STAR-PU / MSPB signal.
  "nzok-casemix-by-eik": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { status: 400, body: { error: "missing eik" } };
    const rows = await dbRows(
      "SELECT nzok_casemix_expected_vs_actual($1) AS r",
      [eik],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One molecule's (INN) full detail → the /molecule/:inn page: headline, its
  // packs, and every hospital that paid above the year median for those packs.
  // Comparison stays at pack identity; a gap is a signpost, not a verdict.
  "nzok-drug-molecule": async (dbRows, q) => {
    const inn = s(q, "inn");
    if (!inn) return { status: 400, body: { error: "missing inn" } };
    const rows = await dbRows("SELECT nzok_drug_molecule_detail($1) AS r", [
      inn,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // One pack's full detail → the /molecule/:inn/pack page: latest dispersion
  // band, the whole monthly median/p25/p75 trend, and the above-median
  // facilities. Pack identity is (nationalNo, nzokCode); one may be blank.
  "nzok-drug-pack": async (dbRows, q) => {
    const nationalNo = s(q, "nationalNo");
    const nzokCode = s(q, "nzokCode");
    if (!nationalNo && !nzokCode)
      return { status: 400, body: { error: "missing nationalNo or nzokCode" } };
    const rows = await dbRows("SELECT nzok_drug_pack_detail($1, $2) AS r", [
      nationalNo,
      nzokCode,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // Per-court натовареност for one year → the /judiciary court-load map (schema
  // 069). Fetched per year so the map never ships the 531 KB all-years JSON.
  "court-load": async (dbRows, q) => {
    const year = clampInt(q.year, 0, 2000, 2100);
    const rows = await dbRows("SELECT court_load_year($1) AS r", [year]).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? { year, courts: [] } };
  },
  "court-load-years": async (dbRows) => {
    const rows = await dbRows("SELECT court_load_years() AS r", []).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? [] };
  },
  // Geolocated ВиК operators + windowed single-bid metric → the /water operator map
  // (schema 073). One marker per operator HQ city, coloured by single-bid share.
  // Windowed [from, to) with sargable COALESCE bounds, same basis as
  // awarder-group-model. Degrades to an empty map on a DB predating the migration.
  "water-operator-map": async (dbRows, q) => {
    const eiks = s(q, "eiks")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => /^\d{9,13}$/.test(e))
      .slice(0, 300);
    if (!eiks.length) return { body: { operators: [] } };
    const rows = await dbRows("SELECT water_operator_map($1, $2, $3) AS r", [
      eiks,
      orNull(q, "from"),
      orNull(q, "to"),
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? { operators: [] } };
  },
  // Geolocated МВР structures (spend + single-bid share per directorate, windowed)
  // → the /sector/security (Полиция / МВР) marker map. Folds the live contracts
  // corpus onto the static mvr_directorate_geo crosswalk server-side (schema 074),
  // so the client fetches ONE scope-aware blob instead of geocoding in the browser.
  // Windowed [from, to) with sargable COALESCE bounds, like awarder-group-model.
  "mvr-directorate-map": async (dbRows, q) => {
    const eiks = s(q, "eiks")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => /^\d{9,13}$/.test(e))
      .slice(0, 300);
    if (!eiks.length) return { status: 400, body: { error: "missing eiks" } };
    const rows = await dbRows("SELECT mvr_directorate_map($1, $2, $3) AS r", [
      eiks,
      orNull(q, "from"),
      orNull(q, "to"),
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? { directorates: [] } };
  },
  "transport-project-map": async (dbRows, q) => {
    const eiks = s(q, "eiks")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => /^\d{9,13}$/.test(e))
      .slice(0, 300);
    if (!eiks.length) return { status: 400, body: { error: "missing eiks" } };
    const rows = await dbRows("SELECT transport_project_map($1, $2, $3) AS r", [
      eiks,
      orNull(q, "from"),
      orNull(q, "to"),
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? { segments: [], points: [] } };
  },
  // Geolocated active excise warehouses → the /customs/warehouses count map
  // (schema 072). One point per warehouse; the client groups them per city.
  "excise-warehouses": async (dbRows) => {
    const rows = await dbRows("SELECT excise_warehouses_map() AS r", []).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? { warehouses: [] } };
  },
  // Geolocated НЗОК hospitals + live spend metrics → the health-pack hospital map
  // at the top of /awarder/121858220 (schema 075). One blob (no params); the browser
  // never geocodes.
  "nzok-hospital-map": async (dbRows) => {
    const rows = await dbRows("SELECT nzok_hospital_map() AS r", []).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? { total: 0, geocoded: 0, hospitals: [] } };
  },
  // Magistrate declared-companies + informational financials (schema 070).
  // One magistrate by normalized name → the /person tile (was the 123 KB file).
  "magistrate-by-name": async (dbRows, q) => {
    const norm = s(q, "norm");
    if (!norm) return { body: null };
    const rows = await dbRows("SELECT magistrate_by_name($1) AS r", [
      norm,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // Magistrates who declared a company by EIK → the /company/:eik tile.
  "magistrate-by-company": async (dbRows, q) => {
    const eik = s(q, "eik");
    if (!eik) return { body: [] };
    const rows = await dbRows("SELECT magistrate_by_company($1) AS r", [
      eik,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  // Slim roster for the procurement combined search.
  "magistrate-search": async (dbRows) => {
    const rows = await dbRows("SELECT magistrate_search() AS r", []).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? { roster: [] } };
  },
  // Top-N (by declared-company count) + stats → the /judiciary tile.
  "magistrate-overview": async (dbRows, q) => {
    const limit = clampInt(q.limit, 8, 1, 5000);
    const rows = await dbRows("SELECT magistrate_overview($1) AS r", [
      limit,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? { magistrates: [], stats: {} } };
  },
  // The "richer bridge": politicians reachable from a magistrate's DECLARED
  // companies over the TR officer graph (schema 071). Empty for almost every
  // magistrate — the /person magistrate tile only renders it on a match.
  "magistrate-politician-links": async (dbRows, q) => {
    const norm = s(q, "norm");
    if (!norm) return { body: [] };
    const depth = clampInt(q.depth, 2, 1, 3);
    const rows = await dbRows(
      "SELECT magistrate_politician_links($1, $2) AS r",
      [norm, depth],
    ).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },

  // Unified person identity (migration 082, resolved by scripts/person/resolve_persons.ts).
  // Distinct from the legacy name-keyed `person`/`person-search` above (the tr_officer
  // graph): these serve the new person_id layer by stable slug + a folded name search.
  //
  // One person's unified cross-source profile → /person/{slug}. Only active + public-safe
  // roles (person_by_slug enforces it); returns null for an unknown or review-status slug.
  "person-profile": async (dbRows, q) => {
    const key = s(q, "slug") || s(q, "name");
    if (!key) return { body: null };
    // Try the stable slug first; fall back to a UNIQUE folded-name match so the legacy
    // /person/{name} links resolve to the unified profile too (person_by_name returns null
    // on a 0- or >1-match name, and the caller then shows the legacy portfolio).
    let rows = await dbRows("SELECT person_by_slug($1) AS r", [key]).catch(
      missingMigrationEmpty,
    );
    if (!rows[0]?.r)
      rows = await dbRows("SELECT person_by_name($1) AS r", [key]).catch(
        missingMigrationEmpty,
      );
    return { body: rows[0]?.r ?? null };
  },
  // Folded name search over the resolved person table → the personSearch AI tool /
  // arbitrary-person lookup. Latin queries match Cyrillic (one normalizer).
  "person-lookup": async (dbRows, q) => {
    const term = s(q, "q");
    if (!term) return { body: [] };
    const lim = clampInt(q.limit, 20, 1, 100);
    const rows = await dbRows("SELECT person_search($1, $2) AS r", [
      term,
      lim,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  // Person↔person edges (shared company, association-noise-guarded) → the Connections
  // component (§8) + the future personConnections AI tool. Public-safe endpoints only;
  // the payload carries its own "лид, не доказателство" disclaimer.
  "person-connections": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: null };
    const rows = await dbRows("SELECT person_connections($1) AS r", [
      slug,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? null };
  },
  // Every election's re-keyed electoral summary for one person (newest first) → the electoral
  // block on the merged person dashboard (person-candidate-merge-v1). The caller runs the
  // existing candidate reducer over each cycle's raw `regions` + preferences_stats fields.
  "person-elections": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: [] };
    const rows = await dbRows("SELECT person_elections($1) AS r", [
      slug,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  // Declared-wealth trajectory: one point per year (assets/debts/net/income +
  // category breakdown) plus entry/vacate markers → the wealth chart (audit T3.1).
  // Off person_by_slug's hot path, lazily loaded. Public-safe (person_wealth_series
  // enforces the §6 gate); empty for an unknown / private slug.
  "person-wealth": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: null };
    const rows = await dbRows("SELECT person_wealth_series($1) AS r", [
      slug,
    ]).catch(missingMigrationEmpty);
    // missingMigrationEmpty degrades to `[{ r: [] }]`; this payload is an object,
    // so an array means "no migration" → null, not a shape the client can read.
    const r = rows[0]?.r;
    return { body: Array.isArray(r) ? null : (r ?? null) };
  },
  // Every declaration this person filed, newest first, with per-filing totals →
  // the unified declaration block (audit T3.3). One payload replaces the three
  // divergent per-tier JSON trees.
  "person-declarations": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: [] };
    const rows = await dbRows("SELECT person_declarations($1) AS r", [
      slug,
    ]).catch(missingMigrationEmpty);
    return { body: rows[0]?.r ?? [] };
  },
  // One filing in full (every asset/income/stake/event row) → the declaration
  // drill-down. Reachable only via the slug-gated lists above, so the opaque id
  // needs no separate gate.
  "declaration-detail": async (dbRows, q) => {
    const id = clampInt(q.id, null, 1, Number.MAX_SAFE_INTEGER);
    if (id == null) return { body: null };
    const rows = await dbRows("SELECT declaration_detail($1) AS r", [id]).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? null };
  },
  // The person's public-contract take bucketed by cabinet tenure (the "money vs power"
  // timeline) → lazily loaded by the money section, kept off person_by_slug's hot path
  // (person-candidate-merge-v1). EIK-exact.
  "person-money": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (!slug) return { body: [] };
    const rows = await dbRows("SELECT person_money($1) AS r", [slug]).catch(
      missingMigrationEmpty,
    );
    return { body: rows[0]?.r ?? [] };
  },
  // Resolve a candidate URL to its owning person's slug so /candidate/{id} can render the
  // shared person dashboard. `slug` = a candidate slug (c-{party}-… | mp-{id}); or `name`
  // (+ optional `party`) for the legacy bare-name candidate URLs. Returns null for an
  // unknown / private / >1-namesake match, and the caller falls through to the legacy render.
  "candidate-person": async (dbRows, q) => {
    const slug = s(q, "slug");
    if (slug) {
      const rows = await dbRows("SELECT candidate_person_slug($1) AS r", [
        slug,
      ]).catch(missingMigrationEmpty);
      return { body: { personSlug: rows[0]?.r ?? null } };
    }
    const name = s(q, "name");
    if (!name) return { body: { personSlug: null } };
    const party = q.party != null ? clampInt(q.party, null, 1, 99) : null;
    const rows = await dbRows(
      "SELECT candidate_person_by_name($1, $2) AS r",
      [name, party],
    ).catch(missingMigrationEmpty);
    return { body: { personSlug: rows[0]?.r ?? null } };
  },
};

module.exports = { DB_ROUTES };
