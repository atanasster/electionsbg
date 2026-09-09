// The /db query library, organised by PURPOSE rather than by table.
//
// It replaced ten samples in four groups rendered as a flat pill row. Ten
// queries stood for 208 listed relations, and the repo already holds 324
// callable functions in `public` — the console surfaced three of them. Nearly
// every entry below is a function call rather than a hand-written join: one
// line, already indexed, already carrying the site's own definitions, and it
// cannot drift from what the pages serve.
//
// Rules for adding one:
//   • it must RUN — sqlLibrary.data.test.ts executes every entry;
//   • `answers` is what a reader learns, not what the SQL does;
//   • a trap that is not visible in the schema goes in a leading SQL comment;
//   • prefer a function over a join, and always bound the result.

export type QueryCost = "fast" | "medium" | "slow";

export interface LibraryQuery {
  /** Stable slug — this is what `/db?q=<id>` names, so it must not churn. */
  id: string;
  label: string;
  /** One line: the question this answers, in the reader's terms. */
  answers: string;
  sql: string;
  /** Rough guide so a visitor knows before running. Prod is slower than local. */
  cost?: QueryCost;
  /**
   * The lateral link this query walks: the two dataset ids and the join key.
   * Lets the map's "Links to" row offer "run this query", which is what makes
   * the map's claim ("these two join on ЕИК") executable rather than a
   * diagram. Checked against LINKS by sqlLibrary.data.test.ts.
   */
  walks?: { a: string; b: string; key: string };
}

export interface LibraryGroup {
  purpose: string;
  queries: LibraryQuery[];
}

export const LIBRARY: LibraryGroup[] = [
  {
    purpose: "Public money — who receives it",
    queries: [
      {
        id: "top-contractors",
        label: "Top contractors",
        answers:
          "Which companies hold the largest awarded contract value in this corpus",
        cost: "medium",
        sql: `-- contractor_rank is the refreshed tag='contract' rollup. The ALL
-- division keeps one row per contractor and avoids rescanning the raw corpus.
SELECT eik AS contractor_eik, name AS contractor_name,
       ROUND(total_eur) AS eur, contract_count AS n
FROM contractor_rank
WHERE scope_key = 'all' AND division = 'ALL'
ORDER BY total_eur DESC NULLS LAST, eik
LIMIT 25;`,
      },
      {
        id: "companies-by-all-public-money",
        label: "Companies by all public money",
        answers:
          "Who received the most across contracts, farm subsidies, EU funds and Interreg combined",
        cost: "fast",
        sql: `-- company_public_money (127) is the ONE broad per-EIK basis:
-- contracts ∪ subsidies ∪ funds ∪ interreg.
-- ⚠ interreg_eur is a SUBSET of public_money_eur, not a second arm — 127
-- computes the rest as (public_money_eur - interreg_eur). Adding the two
-- double-counts €107.1m across the 236 companies that carry any.
SELECT eik, ROUND(public_money_eur) AS all_public_money_eur,
       ROUND(interreg_eur) AS of_which_interreg_eur
FROM company_public_money
ORDER BY public_money_eur DESC NULLS LAST
LIMIT 25;`,
      },
      {
        id: "contractors-ranked-and-scoped",
        label: "Contractors, ranked and scoped",
        answers:
          "The leaderboard the /procurement/contractors page draws, for one time window",
        cost: "fast",
        sql: `-- contractor_rank is a (scope × CPV division) rollup with an 'ALL'
-- sentinel. Filtering to division 'ALL' is what stops one contractor
-- appearing once per division they have ever won in.
SELECT scope_key, eik, name, ROUND(total_eur) AS eur, contract_count, is_mp_tied
FROM contractor_rank
WHERE scope_key = 'all' AND division = 'ALL'
ORDER BY total_eur DESC NULLS LAST
LIMIT 25;`,
      },
    ],
  },
  {
    purpose: "Public money — who spends it",
    queries: [
      {
        id: "top-awarders",
        label: "Top awarders",
        answers: "Which public bodies award the most money",
        cost: "medium",
        sql: `-- awarder_search stores the tag='contract' totals at load time;
-- aliases repeat one EIK's totals, so group them before ranking.
SELECT eik AS awarder_eik, COALESCE(MAX(primary_name), MIN(name)) AS awarder_name,
       ROUND(MAX(contracts_eur)) AS eur, MAX(contracts) AS n
FROM awarder_search
GROUP BY eik
ORDER BY eur DESC NULLS LAST, eik
LIMIT 25;`,
      },
      {
        id: "where-a-buyer-sits",
        label: "Where a buyer sits",
        answers:
          "The settlement, município and oblast a contracting authority is seated in",
        cost: "fast",
        sql: `SELECT eik, settlement, municipality, oblast, tier, is_local_hq
FROM awarder_seats
ORDER BY oblast, municipality, settlement
LIMIT 50;`,
      },
      {
        id: "biggest-tenders",
        label: "Biggest tenders",
        answers: "The largest procedures put out to tender, by forecast value",
        cost: "fast",
        sql: `-- estimated_value_eur is the buyer's FORECAST at announcement, not what
-- was paid. Compare it with the awarded total below rather than reading it as
-- spend.
SELECT publication_date, buyer_name, subject,
       ROUND(estimated_value_eur) AS forecast_eur, procedure_type
FROM tenders
WHERE estimated_value_eur IS NOT NULL AND NOT is_cancelled
ORDER BY estimated_value_eur DESC NULLS LAST
LIMIT 50;`,
      },
      {
        id: "forecast-vs-actual",
        label: "Forecast vs actual",
        answers:
          "How the announced value compares with what was eventually awarded",
        cost: "medium",
        sql: `-- Compare the 50 largest announced procedures. The join key is УНП,
-- and tag='contract' excludes amendment rows from the awarded value.
WITH announced AS (
  SELECT unp, buyer_name, subject, estimated_value_eur
  FROM tenders
  WHERE estimated_value_eur IS NOT NULL
  ORDER BY estimated_value_eur DESC
  LIMIT 50
)
SELECT t.buyer_name, t.subject,
       ROUND(t.estimated_value_eur) AS forecast_eur,
       ROUND(a.awarded_eur) AS awarded_eur
FROM announced t
LEFT JOIN LATERAL (
  SELECT SUM(c.amount_eur) AS awarded_eur
  FROM contracts c
  WHERE c.unp = t.unp AND c.tag = 'contract'
) a ON true
ORDER BY forecast_eur DESC NULLS LAST;`,
      },
      {
        id: "one-buyer-s-procurement-profile",
        label: "One buyer's procurement profile",
        answers:
          "What a single authority buys, from whom, and how competitively",
        cost: "fast",
        sql: `-- 000695089 is АПИ (the road agency), the largest single awarder.
-- The function returns ONE jsonb object, which the grid would show as a
-- single [object Object] cell — pull the scalars out and expand the arrays
-- separately if you need them.
SELECT p->>'totalEur' AS total_eur, p->>'contractCount' AS contracts,
       p->>'awardCount' AS awards, p->>'amendmentCount' AS amendments,
       jsonb_array_length(p->'topContracts') AS top_contracts
FROM awarder_procurement('000695089') AS p;`,
      },
    ],
  },
  {
    purpose: "Risk & competition",
    queries: [
      {
        id: "single-bidder-contracts",
        label: "Single-bidder contracts",
        answers: "The largest contracts where only one company bid",
        cost: "fast",
        sql: `SELECT date, awarder_name, contractor_name, amount_eur
FROM contracts
WHERE tag = 'contract' AND number_of_tenderers = 1
ORDER BY amount_eur DESC NULLS LAST
LIMIT 50;`,
      },
      {
        id: "riskiest-buyers",
        label: "Riskiest buyers",
        answers: "Authorities whose contracts fire the most red flags, A–F",
        cost: "fast",
        sql: `-- Returns one jsonb object holding a rows array; expand it or the grid shows
-- a single [object Object] cell.
SELECT r->>'eik' AS eik, r->>'name' AS awarder, r->>'grade' AS grade,
       r->>'score' AS score
FROM awarder_risk_grade_top('all', 20, 0) AS t,
     jsonb_array_elements(t->'rows') AS r
LIMIT 20;`,
      },
      {
        id: "appeals-and-how-they-ended",
        label: "Appeals and how they ended",
        answers: "Recent КЗК complaints against procurement decisions",
        cost: "fast",
        sql: `-- 'отказано производство' is a DETERMINATE ending (the filing was refused),
-- not a missing outcome — kzk_effective_outcome derives it at query time
-- rather than storing it, so the provenance of hand-seeded rows survives.
-- The function returns a jsonb ARRAY; expand it to get one row per appeal.
SELECT a->>'complaintNo' AS complaint, a->>'complaintDate' AS filed,
       a->>'buyerName' AS buyer, a->>'complainant' AS complainant,
       a->>'status' AS status, a->>'outcome' AS outcome
FROM kzk_recent_appeals(30) AS t, jsonb_array_elements(t) AS a
LIMIT 30;`,
      },
    ],
  },
  {
    purpose: "People & roles",
    queries: [
      {
        id: "find-a-person",
        label: "Find a person",
        answers: "One name across every people dataset the project holds",
        cost: "fast",
        sql: `SELECT name, tier, primary_role, party, place_label, firms_count,
       ROUND(public_money_eur) AS public_money_eur
FROM person_search
WHERE name_fold LIKE '%' || translit_bg_latin('борисов') || '%'
ORDER BY public_money_eur DESC NULLS LAST
LIMIT 25;`,
      },
      {
        id: "a-person-s-declared-wealth-by-year",
        label: "A person's declared wealth by year",
        answers: "What one official declared, year by year, and how it moved",
        cost: "fast",
        sql: `-- person_wealth_year picks ONE declaration per (person, period), so a
-- holding re-declared on several filings is not counted twice.
SELECT p.display_name, w.period_year, ROUND(w.assets_eur) AS assets_eur,
       ROUND(w.debts_eur) AS debts_eur, ROUND(w.net_eur) AS net_eur,
       w.excluded_asset_rows, w.imputed_asset_rows
FROM person_wealth_year w
JOIN person p USING (person_id)
ORDER BY w.net_eur DESC NULLS LAST
LIMIT 25;`,
      },
      {
        id: "money-declared-abroad",
        label: "Money declared abroad",
        answers:
          "Which officials declare bank or investment holdings outside Bulgaria",
        cost: "fast",
        sql: `-- Coverage is NARROWER than "money": held_scope exists only on the bank
-- and investment tables, so magistrates are absent entirely. Never publish a
-- bare percentage from this — see person_abroad_overview() for the basis.
SELECT person_name, institution, period_year, held_country,
       ROUND(value_eur) AS value_eur
FROM person_abroad_table
WHERE scope = 'latest'
ORDER BY value_eur DESC NULLS LAST
LIMIT 25;`,
      },
    ],
  },
  {
    purpose: "Companies & ownership",
    queries: [
      {
        id: "who-owns-a-company",
        label: "Who owns a company",
        answers: "The current cap table for one EIK, as percentages",
        cost: "fast",
        sql: `-- tr_owner_share, never tr_person_roles.share: the registry re-lists the
-- WHOLE partner set on every capital change and never erases the old vintage,
-- so summing non-erased rows counts the cap table once per filing.
SELECT * FROM tr_owner_share WHERE uic = '104119056' LIMIT 50;`,
      },
      {
        id: "officers-of-a-company",
        label: "Officers of a company",
        answers: "Directors, managers and owners on record for one EIK",
        cost: "fast",
        sql: `SELECT * FROM company_officers('204332614') LIMIT 30;`,
      },
      {
        id: "politically-connected-companies",
        label: "Politically connected companies",
        answers:
          "Firms linked to an MP or official, and the public money they hold",
        cost: "fast",
        sql: `SELECT eik, politician, kind, role, ROUND(total_eur) AS total_eur
FROM company_politicians
ORDER BY total_eur DESC NULLS LAST
LIMIT 25;`,
      },
    ],
  },
  {
    purpose: "Places",
    queries: [
      {
        id: "companies-registered-in-a-place",
        label: "Companies registered in a place",
        answers:
          "Which firms are seated in one settlement, ranked by public money",
        cost: "fast",
        sql: `-- 68134 is Sofia. money_eur and political_n are DENORMALIZED from
-- company_public_money and company_politicians, so they are only as fresh as
-- the last db:load:tr-company-place run.
SELECT * FROM tr_company_place
WHERE ekatte = '68134'
ORDER BY money_eur DESC NULLS LAST
LIMIT 25;`,
      },
      {
        id: "municipal-financial-health",
        label: "Municipal financial health",
        answers:
          "The quarterly indicators that decide whether a município is in fiscal difficulty",
        cost: "fast",
        sql: `-- meets_threshold is NULL unless the ministry published a verdict: only
-- 3 of the statute's 7 criteria are computable from this source, and
-- criteria_evaluable records which were actually checkable.
SELECT obshtina, fiscal_year, quarter, ROUND(arrears_eur) AS arrears_eur,
       ROUND(commitments_eur) AS commitments_eur
FROM municipal_fiscal
ORDER BY fiscal_year DESC, quarter DESC, obshtina
LIMIT 50;`,
      },
    ],
  },
  {
    purpose: "EU money — can I apply",
    queries: [
      {
        id: "what-is-open-right-now",
        label: "What is open right now",
        answers: "Calls a reader could apply to today, with their deadlines",
        cost: "fast",
        sql: `-- Status is derived by comparing closes_at to now() at QUERY time, never
-- stored: a stored status would show expired calls as open all weekend after a
-- Friday crawl failure. NULL limit means UNBOUNDED — always pass one.
SELECT * FROM open_calls_list('open', 'call', NULL, NULL, 50);`,
      },
      {
        id: "base-rates-for-a-procedure",
        label: "Base rates for a procedure",
        answers:
          "How many projects a procedure disbursed to before, and the median grant",
        cost: "fast",
        sql: `-- paid_project_count is DISBURSEMENT, not approval. ИСУН publishes no
-- rejected applications, so an approval rate has no denominator and cannot be
-- computed from this corpus.
SELECT * FROM fund_fit
ORDER BY project_count DESC NULLS LAST
LIMIT 25;`,
      },
      {
        id: "clean-delivery-register",
        label: "Clean delivery register",
        answers:
          "EU-funded contracts that finished with no financial correction",
        cost: "fast",
        sql: `-- An ACHIEVEMENT register, never the complement of "was corrected": a
-- project can be absent for finishing late or being terminated, and
-- irregularity records are confidential. Subtracting this from fund_projects
-- would manufacture accusations.
SELECT * FROM isun_clean_delivery_coverage LIMIT 10;`,
      },
    ],
  },
  {
    purpose: "Cross-border (Interreg)",
    queries: [
      {
        id: "interreg-operations",
        label: "Interreg operations",
        answers:
          "Cross-border projects and their budgets — the corpus ИСУН does not hold",
        cost: "fast",
        sql: `-- NEVER summed with fund_projects: Interreg runs on Jems, holds zero rows
-- there, and an ИСУН figure is a contract's own value while an Interreg figure
-- is one partner's published budget.
SELECT keep_id, COALESCE(title_bg, title_en) AS title, programme_code,
       ROUND(total_budget_eur) AS total_eur, ROUND(eu_funding_eur) AS eu_eur
FROM interreg_operations
ORDER BY total_budget_eur DESC NULLS LAST
LIMIT 25;`,
      },
      {
        id: "bulgarian-interreg-partners",
        label: "Bulgarian Interreg partners",
        answers: "Which Bulgarian organisations take part, and for how much",
        cost: "fast",
        sql: `-- Only ~12% of partner rows carry a place, so never report a place
-- breakdown against the full partner count.
SELECT partner_name, eik, country, ROUND(budget_eur) AS eur, ekatte, oblast
FROM interreg_partners
WHERE country ILIKE '%ulgar%'
ORDER BY budget_eur DESC NULLS LAST
LIMIT 25;`,
      },
    ],
  },
  {
    purpose: "Parliament & voting",
    queries: [
      {
        id: "voting-twins",
        label: "Voting twins",
        answers: "Which MPs vote together most often",
        cost: "medium",
        sql: `-- mp_similarity stores dot + overlap, NOT an agreement rate. The score
-- consumers are calibrated for is the cosine, via mp_vote_norm.
SELECT s.ns, s.a_mp, s.b_mp, s.overlap,
       ROUND((s.dot / NULLIF(sqrt(a.norm_sq * b.norm_sq), 0))::numeric, 4) AS cosine
FROM mp_similarity s
JOIN mp_vote_norm a ON a.ns = s.ns AND a.mp_id = s.a_mp
JOIN mp_vote_norm b ON b.ns = s.ns AND b.mp_id = s.b_mp
WHERE s.overlap > 100
ORDER BY cosine DESC NULLS LAST
LIMIT 25;`,
      },
      {
        id: "party-cohesion",
        label: "Party cohesion",
        answers: "How often a party's MPs vote the same way",
        cost: "fast",
        sql: `SELECT ns, party_label, items_covered, members_tracked,
       ROUND(mean_cohesion::numeric, 3) AS mean_cohesion
FROM party_cohesion_summary
ORDER BY ns DESC, mean_cohesion DESC NULLS LAST
LIMIT 30;`,
      },
      {
        id: "a-day-in-the-chamber",
        label: "A day in the chamber",
        answers: "Every vote taken on one sitting day, with its outcome",
        cost: "fast",
        sql: `-- vote_item holds ALL raw items: re-votes carry superseded_by, so every
-- AGGREGATE needs "WHERE superseded_by IS NULL" or it over-counts by ~10%.
SELECT ns, date, COUNT(*) AS items, SUM(yes) AS yes, SUM(no) AS no
FROM vote_item
WHERE superseded_by IS NULL
GROUP BY ns, date
ORDER BY date DESC
LIMIT 30;`,
      },
    ],
  },
  {
    purpose: "Health (НЗОК)",
    queries: [
      {
        id: "what-the-health-fund-pays-each-hospital",
        label: "What the health fund pays each hospital",
        answers: "Per-hospital payments for inpatient care",
        cost: "fast",
        sql: `SELECT name, eik, period, rzok_name, stream, ownership,
       ROUND(cumulative_eur) AS cumulative_eur
FROM nzok_hospital_payments
ORDER BY cumulative_eur DESC NULLS LAST
LIMIT 25;`,
      },
      {
        id: "medicine-reimbursement-by-molecule",
        label: "Medicine reimbursement by molecule",
        answers: "What the fund spends per active substance",
        cost: "fast",
        sql: `-- Returns one jsonb object whose top key holds the per-molecule array.
SELECT d->>'inn' AS molecule, d->>'eur' AS eur, d->>'packs' AS packs
FROM nzok_drug_quarterly_overview() AS t,
     jsonb_array_elements(t->'top') AS d
LIMIT 30;`,
      },
    ],
  },
  {
    // Every query here JOINS two corpora — these are what the map's lateral
    // links point at, so a reader can run the claim rather than read it. A
    // query that touches only one side would make the "run this query"
    // affordance decorative, which is exactly what the first cut shipped.
    purpose: "Where the corpora meet",
    queries: [
      {
        id: "contractors-in-the-registry",
        label: "Contractors in the company registry",
        answers:
          "Procurement winners matched to their Commerce Registry record — the ЕИК link",
        cost: "medium",
        walks: { a: "connections", b: "procurement", key: "eik" },
        sql: `-- The ЕИК link: contractor_rank.eik × tr_companies.uic.
SELECT co.uic, co.name, co.legal_form, co.status,
       ROUND(r.total_eur) AS eur, r.contract_count AS contracts
FROM contractor_rank r
JOIN tr_companies co ON co.uic = r.eik
WHERE r.scope_key = 'all' AND r.division = 'ALL'
ORDER BY r.total_eur DESC NULLS LAST, co.uic
LIMIT 25;`,
      },
      {
        id: "both-contracts-and-eu-funds",
        label: "Both contracts and EU funds",
        answers: "Companies that take public contracts AND EU grants",
        cost: "medium",
        walks: { a: "funds", b: "procurement", key: "eik" },
        sql: `-- Two DIFFERENT money bases: a contract's own value against a grant's.
-- They are shown side by side, never summed into one figure.
SELECT b.eik, b.name AS beneficiary,
       ROUND(b.contracted_eur) AS funds_contracted_eur,
       ROUND((SELECT SUM(c.amount_eur) FROM contracts c
               WHERE c.contractor_eik = b.eik AND c.tag = 'contract')) AS procurement_eur
FROM fund_beneficiaries b
WHERE EXISTS (SELECT 1 FROM contracts c
               WHERE c.contractor_eik = b.eik AND c.tag = 'contract')
ORDER BY b.contracted_eur DESC NULLS LAST
LIMIT 25;`,
      },
      {
        id: "officials-who-hold-company-roles",
        label: "Officials who hold company roles",
        answers:
          "Declaring officials who also appear in the Commerce Registry — the person link",
        cost: "fast",
        walks: { a: "connections", b: "officials", key: "person_id" },
        sql: `-- person_role must be SCOPED to registry sources. Unscoped it holds a row
-- for every declarant too, so the join answers "does this person exist" and
-- returns 100% — a true count and a false sentence.
SELECT p.display_name, count(DISTINCT r.ref) AS company_roles,
       min(d.institution) AS institution
FROM declaration d
JOIN person p ON p.person_id = d.person_id
JOIN person_role r ON r.person_id = d.person_id AND r.source IN ('tr','ngo')
GROUP BY p.person_id, p.display_name
ORDER BY company_roles DESC
LIMIT 25;`,
      },
      {
        id: "hospitals-that-also-buy",
        label: "Hospitals that also run procurement",
        answers:
          "Facilities the health fund pays which are themselves contracting authorities",
        cost: "fast",
        walks: { a: "health", b: "procurement", key: "eik" },
        sql: `-- The same legal entity on both sides: a hospital is paid by НЗОК and is
-- itself a ЗОП contracting authority.
SELECT n.eik, MIN(n.name) AS hospital,
       ROUND(MAX(n.cumulative_eur)) AS nzok_eur,
       ROUND(SUM(c.amount_eur)) AS awarded_eur
FROM nzok_hospital_payments n
JOIN contracts c ON c.awarder_eik = n.eik AND c.tag = 'contract'
GROUP BY n.eik
ORDER BY awarded_eur DESC NULLS LAST
LIMIT 25;`,
      },
    ],
  },
  {
    purpose: "Search across everything",
    queries: [
      {
        id: "name-search",
        label: "Name search",
        answers: "One name across companies, officers and contractors at once",
        cost: "fast",
        sql: `SELECT * FROM search_companies('лукойл', 20);`,
      },
      {
        id: "unified-search",
        label: "Unified search",
        answers:
          "Companies, officers and non-registry contractors in one ranked feed",
        cost: "fast",
        sql: `SELECT * FROM search_all('лукойл', 30);`,
      },
    ],
  },
  {
    purpose: "Data quality & freshness",
    queries: [
      {
        id: "what-changed-recently",
        label: "What changed recently",
        answers: "New rows across every dataset, newest first",
        cost: "medium",
        sql: `-- Bulk days collapse to one summary line per (source, day) rather than
-- itemising 100k rows; the threshold is 500 new rows.
SELECT * FROM recent_updates(7, 100);`,
      },
      {
        id: "corpus-sizes",
        label: "Corpus sizes",
        answers:
          "How big each table is — an estimate, stale until autovacuum runs",
        cost: "fast",
        sql: `-- reltuples, NOT pg_stat_user_tables.n_live_tup: n_live_tup is reset by
-- a reload and stays 0 until autovacuum analyzes, which on this database is
-- true of 232 of 238 relations — ordering by it ranks a scratch table above
-- the contracts corpus. Both are ESTIMATES; use count(*) when it matters.
SELECT c.relname AS relation, c.relkind::text AS kind,
       GREATEST(c.reltuples, 0)::bigint AS estimated_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','m')
ORDER BY c.reltuples DESC
LIMIT 40;`,
      },
    ],
  },
];

/** Flat view, for the search box and for tests. */
export const ALL_QUERIES: Array<LibraryQuery & { purpose: string }> =
  LIBRARY.flatMap((g) => g.queries.map((q) => ({ ...q, purpose: g.purpose })));
