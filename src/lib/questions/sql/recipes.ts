import { BUDGET_SQL_RECIPES, EXPANDED_SQL_RECIPES } from "./expanded";
import { LIBRARY as LEGACY_LIBRARY } from "./legacy";
import { sqlCode, sqlDate, sqlInteger, sqlText } from "./literals";
import type { SqlRecipe, SqlRecipeParameter } from "./types";
import {
  MUNICIPAL_FISCAL_LATEST_VALIDATED_YEAR,
  MUNICIPAL_FISCAL_MAX_RESULTS,
  MUNICIPAL_FISCAL_MAX_YEAR,
  MUNICIPAL_FISCAL_METRICS,
  MUNICIPAL_FISCAL_MIN_YEAR,
  type MunicipalFiscalMetric,
} from "../contracts/municipalFiscal";
import {
  ELECTION_ROUND_MAX,
  ELECTION_ROUND_MIN,
  LATEST_PARLIAMENTARY_CONTEST,
  LATEST_PRESIDENTIAL_CONTEST,
  PRESIDENTIAL_CONTESTS,
} from "../contracts/elections";

type ParameterizedRecipe = {
  parameters: SqlRecipeParameter[];
  build: (parameters: Record<string, string | number>) => string;
};

const limit = (parameters: Record<string, string | number>, fallback: number) =>
  sqlInteger(parameters.limit ?? fallback, "limit", 1, 2000);

const PARAMETERIZED: Record<string, ParameterizedRecipe> = {
  "contractors-ranked-and-scoped": {
    parameters: [
      {
        id: "scope",
        kind: "enum",
        required: true,
        default: "all",
        values: ["all", "y:2024", "y:2025", "y:2026"],
      },
    ],
    build: ({
      scope,
    }) => `-- contractor_rank is a (scope × CPV division) rollup with an 'ALL'
-- sentinel. Filtering to division 'ALL' stops duplicate contractor rows.
SELECT scope_key, eik, name, ROUND(total_eur) AS eur, contract_count, is_mp_tied
FROM contractor_rank
WHERE scope_key = ${sqlCode(scope, "scope")} AND division = 'ALL'
ORDER BY total_eur DESC NULLS LAST
LIMIT 25;`,
  },
  "one-buyer-s-procurement-profile": {
    parameters: [
      { id: "eik", kind: "code", required: true, default: "000695089" },
    ],
    build: ({ eik }) => `-- Awarded procurement profile for one buyer EIK.
-- Values are awarded contract amounts; they are not payments.
SELECT p->>'totalEur' AS total_eur, p->>'contractCount' AS contracts,
       p->>'awardCount' AS awards, p->>'amendmentCount' AS amendments,
       jsonb_array_length(p->'topContracts') AS top_contracts
FROM awarder_procurement(${sqlCode(eik, "eik")}) AS p;`,
  },
  "find-a-person": {
    parameters: [
      { id: "name", kind: "text", required: true, default: "борисов" },
      {
        id: "limit",
        kind: "integer",
        required: false,
        default: 25,
        min: 1,
        max: 2000,
      },
    ],
    build: (
      parameters,
    ) => `SELECT name, tier, primary_role, party, place_label, firms_count,
       ROUND(public_money_eur) AS public_money_eur
FROM person_search
WHERE name_fold LIKE '%' || translit_bg_latin(${sqlText(parameters.name, "name")}) || '%'
ORDER BY public_money_eur DESC NULLS LAST
LIMIT ${limit(parameters, 25)};`,
  },
  "who-owns-a-company": {
    parameters: [
      { id: "eik", kind: "code", required: true, default: "104119056" },
      {
        id: "limit",
        kind: "integer",
        required: false,
        default: 50,
        min: 1,
        max: 2000,
      },
    ],
    build: (
      parameters,
    ) => `-- tr_owner_share, never tr_person_roles.share: the registry re-lists the
-- whole partner set on every capital change. This is the current cap table.
SELECT * FROM tr_owner_share
WHERE uic = ${sqlCode(parameters.eik, "eik")}
LIMIT ${limit(parameters, 50)};`,
  },
  "officers-of-a-company": {
    parameters: [
      { id: "eik", kind: "code", required: true, default: "204332614" },
      {
        id: "limit",
        kind: "integer",
        required: false,
        default: 30,
        min: 1,
        max: 2000,
      },
    ],
    build: (parameters) =>
      `SELECT * FROM company_officers(${sqlCode(parameters.eik, "eik")}) LIMIT ${limit(parameters, 30)};`,
  },
  "companies-registered-in-a-place": {
    parameters: [
      { id: "ekatte", kind: "code", required: true, default: "68134" },
      {
        id: "limit",
        kind: "integer",
        required: false,
        default: 25,
        min: 1,
        max: 2000,
      },
    ],
    build: (
      parameters,
    ) => `-- money_eur and political_n are denormalized and reflect the last
-- tr-company-place load.
SELECT * FROM tr_company_place
WHERE ekatte = ${sqlCode(parameters.ekatte, "ekatte")}
ORDER BY money_eur DESC NULLS LAST
LIMIT ${limit(parameters, 25)};`,
  },
  "name-search": {
    parameters: [
      { id: "query", kind: "text", required: true, default: "лукойл" },
      {
        id: "limit",
        kind: "integer",
        required: false,
        default: 20,
        min: 1,
        max: 100,
      },
    ],
    build: (parameters) =>
      `SELECT * FROM search_companies(${sqlText(parameters.query, "query")}, ${sqlInteger(parameters.limit ?? 20, "limit", 1, 100)});`,
  },
  "unified-search": {
    parameters: [
      { id: "query", kind: "text", required: true, default: "лукойл" },
      {
        id: "limit",
        kind: "integer",
        required: false,
        default: 30,
        min: 1,
        max: 100,
      },
    ],
    build: (parameters) =>
      `SELECT * FROM search_all(${sqlText(parameters.query, "query")}, ${sqlInteger(parameters.limit ?? 30, "limit", 1, 100)});`,
  },
  "a-day-in-the-chamber": {
    parameters: [{ id: "from", kind: "date", required: false }],
    build: ({
      from,
    }) => `-- vote_item holds ALL raw items: re-votes carry superseded_by, so every
-- aggregate excludes superseded items.
SELECT ns, date, COUNT(*) AS items, SUM(yes) AS yes, SUM(no) AS no
FROM vote_item
WHERE superseded_by IS NULL${from ? ` AND date >= ${sqlDate(from, "from")}` : ""}
GROUP BY ns, date
ORDER BY date DESC
LIMIT 30;`,
  },
  "what-changed-recently": {
    parameters: [
      {
        id: "days",
        kind: "integer",
        required: true,
        default: 7,
        min: 1,
        max: 3650,
      },
      {
        id: "limit",
        kind: "integer",
        required: true,
        default: 100,
        min: 1,
        max: 2000,
      },
    ],
    build: (
      parameters,
    ) => `-- Bulk days collapse to one summary line per (source, day) rather than
-- itemising 100k rows; the threshold is 500 new rows.
SELECT * FROM recent_updates(${sqlInteger(parameters.days, "days", 1, 3650)}, ${limit(parameters, 100)});`,
  },
};

type RecipeContract = { relations: string[]; outputColumns: string[] };

// Reviewed against the serving migrations. These are contracts, not best-effort
// SQL parsing: comments, nested SELECTs, and SELECT * must never change them.
export const RECIPE_CONTRACTS: Record<string, RecipeContract> = {
  "top-contractors": {
    relations: ["contracts"],
    outputColumns: ["contractor_eik", "contractor_name", "eur", "n"],
  },
  "companies-by-all-public-money": {
    relations: ["company_public_money"],
    outputColumns: ["eik", "all_public_money_eur", "of_which_interreg_eur"],
  },
  "contractors-ranked-and-scoped": {
    relations: ["contractor_rank"],
    outputColumns: [
      "scope_key",
      "eik",
      "name",
      "eur",
      "contract_count",
      "is_mp_tied",
    ],
  },
  "top-awarders": {
    relations: ["contracts"],
    outputColumns: ["awarder_eik", "awarder_name", "eur", "n"],
  },
  "where-a-buyer-sits": {
    relations: ["awarder_seats"],
    outputColumns: [
      "eik",
      "settlement",
      "municipality",
      "oblast",
      "tier",
      "is_local_hq",
    ],
  },
  "biggest-tenders": {
    relations: ["tenders"],
    outputColumns: [
      "publication_date",
      "buyer_name",
      "subject",
      "forecast_eur",
      "procedure_type",
    ],
  },
  "forecast-vs-actual": {
    relations: ["tenders", "contracts"],
    outputColumns: ["buyer_name", "subject", "forecast_eur", "awarded_eur"],
  },
  "one-buyer-s-procurement-profile": {
    relations: ["awarder_procurement"],
    outputColumns: [
      "total_eur",
      "contracts",
      "awards",
      "amendments",
      "top_contracts",
    ],
  },
  "single-bidder-contracts": {
    relations: ["contracts"],
    outputColumns: ["date", "awarder_name", "contractor_name", "amount_eur"],
  },
  "riskiest-buyers": {
    relations: ["awarder_risk_grade_top"],
    outputColumns: ["eik", "awarder", "grade", "score"],
  },
  "appeals-and-how-they-ended": {
    relations: ["kzk_recent_appeals"],
    outputColumns: [
      "complaint",
      "filed",
      "buyer",
      "complainant",
      "status",
      "outcome",
    ],
  },
  "find-a-person": {
    relations: ["person_search"],
    outputColumns: [
      "name",
      "tier",
      "primary_role",
      "party",
      "place_label",
      "firms_count",
      "public_money_eur",
    ],
  },
  "a-person-s-declared-wealth-by-year": {
    relations: ["person_wealth_year", "person"],
    outputColumns: [
      "display_name",
      "period_year",
      "assets_eur",
      "debts_eur",
      "net_eur",
      "excluded_asset_rows",
      "imputed_asset_rows",
    ],
  },
  "money-declared-abroad": {
    relations: ["person_abroad_table"],
    outputColumns: [
      "person_name",
      "institution",
      "period_year",
      "held_country",
      "value_eur",
    ],
  },
  "who-owns-a-company": {
    relations: ["tr_owner_share"],
    outputColumns: ["uic", "name_fold", "role", "share_pct", "share_eur"],
  },
  "officers-of-a-company": {
    relations: ["company_officers"],
    outputColumns: [
      "name",
      "role",
      "share",
      "share_eur",
      "share_amount",
      "share_currency",
      "added_at",
      "erased_at",
      "active",
    ],
  },
  "politically-connected-companies": {
    relations: ["company_politicians"],
    outputColumns: ["eik", "politician", "kind", "role", "total_eur"],
  },
  "companies-registered-in-a-place": {
    relations: ["tr_company_place"],
    outputColumns: [
      "uic",
      "ekatte",
      "settlement",
      "obshtina",
      "municipality",
      "oblast",
      "is_village",
      "confidence",
      "name",
      "money_eur",
      "political_n",
      "person_link_n",
    ],
  },
  "municipal-financial-health": {
    relations: ["municipal_fiscal"],
    outputColumns: [
      "obshtina",
      "fiscal_year",
      "quarter",
      "arrears_eur",
      "commitments_eur",
    ],
  },
  "what-is-open-right-now": {
    relations: ["open_calls_list"],
    outputColumns: [
      "id",
      "source",
      "source_key",
      "code",
      "kind",
      "title",
      "programme_code",
      "programme_name",
      "objective",
      "status",
      "date_precision",
      "opens_at",
      "closes_at",
      "period_label",
      "days_left",
      "budget_eur",
      "budget_note",
      "aid_rate_pct",
      "grant_min_eur",
      "grant_max_eur",
      "beneficiaries_raw",
      "audience",
      "territory",
      "source_url",
      "docs",
      "enrichment",
      "first_seen_at",
      "last_seen_at",
      "checked_at",
    ],
  },
  "base-rates-for-a-procedure": {
    relations: ["fund_fit"],
    outputColumns: [
      "procedure_code",
      "program_code",
      "program_name",
      "procedure_name",
      "sample_title",
      "project_count",
      "beneficiary_count",
      "paid_project_count",
      "total_eur",
      "grant_eur",
      "paid_eur",
      "grant_p25",
      "grant_median",
      "grant_p75",
      "org_forms",
      "org_kinds",
      "oblasti",
      "search_text",
    ],
  },
  "clean-delivery-register": {
    relations: ["isun_clean_delivery_coverage"],
    outputColumns: [
      "id",
      "built_at",
      "contract_criterion",
      "beneficiary_criterion",
      "absence_meaning",
      "contracts",
      "beneficiaries",
      "natural_persons_excluded",
      "on_time_contracts_declared",
      "programmes",
    ],
  },
  "interreg-operations": {
    relations: ["interreg_operations"],
    outputColumns: [
      "keep_id",
      "title",
      "programme_code",
      "total_eur",
      "eu_eur",
    ],
  },
  "bulgarian-interreg-partners": {
    relations: ["interreg_partners"],
    outputColumns: [
      "partner_name",
      "eik",
      "country",
      "eur",
      "ekatte",
      "oblast",
    ],
  },
  "voting-twins": {
    relations: ["mp_similarity", "mp_vote_norm"],
    outputColumns: ["ns", "a_mp", "b_mp", "overlap", "cosine"],
  },
  "party-cohesion": {
    relations: ["party_cohesion_summary"],
    outputColumns: [
      "ns",
      "party_label",
      "items_covered",
      "members_tracked",
      "mean_cohesion",
    ],
  },
  "a-day-in-the-chamber": {
    relations: ["vote_item"],
    outputColumns: ["ns", "date", "items", "yes", "no"],
  },
  "what-the-health-fund-pays-each-hospital": {
    relations: ["nzok_hospital_payments"],
    outputColumns: [
      "name",
      "eik",
      "period",
      "rzok_name",
      "stream",
      "ownership",
      "cumulative_eur",
    ],
  },
  "medicine-reimbursement-by-molecule": {
    relations: ["nzok_drug_quarterly_overview"],
    outputColumns: ["molecule", "eur", "packs"],
  },
  "contractors-in-the-registry": {
    relations: ["contracts", "tr_companies"],
    outputColumns: ["uic", "name", "legal_form", "status", "eur", "contracts"],
  },
  "both-contracts-and-eu-funds": {
    relations: ["fund_beneficiaries", "contracts"],
    outputColumns: [
      "eik",
      "beneficiary",
      "funds_contracted_eur",
      "procurement_eur",
    ],
  },
  "officials-who-hold-company-roles": {
    relations: ["declaration", "person", "person_role"],
    outputColumns: ["display_name", "company_roles", "institution"],
  },
  "hospitals-that-also-buy": {
    relations: ["nzok_hospital_payments", "contracts"],
    outputColumns: ["eik", "hospital", "nzok_eur", "awarded_eur"],
  },
  "name-search": {
    relations: ["search_companies"],
    outputColumns: [
      "uic",
      "name",
      "legal_form",
      "status",
      "contracts",
      "contracts_eur",
      "sim",
    ],
  },
  "unified-search": {
    relations: ["search_all"],
    outputColumns: [
      "kind",
      "eik",
      "name",
      "detail",
      "contracts",
      "contracts_eur",
      "own_eur",
      "primary_name",
      "sim",
    ],
  },
  "what-changed-recently": {
    relations: ["recent_updates"],
    outputColumns: [
      "kind",
      "id",
      "eik",
      "name",
      "detail",
      "changed_at",
      "amount_eur",
    ],
  },
  "corpus-sizes": {
    relations: ["pg_class", "pg_namespace"],
    outputColumns: ["relation", "kind", "estimated_rows"],
  },
};

export const SQL_RECIPE_GROUPS = LEGACY_LIBRARY.map((group) => ({
  purpose: group.purpose,
  recipes: group.queries.map((query): SqlRecipe => {
    const configured = PARAMETERIZED[query.id];
    const build = configured?.build ?? (() => query.sql);
    return {
      id: query.id,
      questionId: query.id,
      version: 1,
      label: query.label,
      answers: query.answers,
      purpose: group.purpose,
      cost: query.cost,
      walks: query.walks,
      parameters: configured?.parameters ?? [],
      relations: RECIPE_CONTRACTS[query.id].relations,
      outputColumns: RECIPE_CONTRACTS[query.id].outputColumns,
      build,
    };
  }),
}));

export const LEGACY_SQL_RECIPES = SQL_RECIPE_GROUPS.flatMap(
  (group) => group.recipes,
);

export const CHAT_SQL_RECIPES: SqlRecipe[] = [
  ...BUDGET_SQL_RECIPES,
  {
    id: "nationalResults",
    questionId: "nationalResults",
    version: 1,
    label: "Latest parliamentary election results",
    answers:
      "National CIK results for the latest parliamentary election, including turnout and seats",
    purpose: "Elections & parliament",
    parameters: [
      {
        id: "election",
        kind: "code",
        required: true,
        default: LATEST_PARLIAMENTARY_CONTEST,
      },
    ],
    relations: ["election_national_results"],
    outputColumns: [
      "election_id",
      "contest_key",
      "election_type",
      "result_grain",
      "election_date",
      "round",
      "registered_voters",
      "actual_voters",
      "pct_denominator_votes",
      "none_of_above_votes",
      "invalid_votes",
      "percentage_basis",
      "choice_key",
      "choice_kind",
      "choice_number",
      "canonical_party_id",
      "president_name",
      "vice_president_name",
      "choice_name",
      "choice_short",
      "votes",
      "pct",
      "seats",
      "passed_threshold",
      "source_path",
      "source_sha256",
      "granular_source_path",
      "granular_sha256",
    ],
    build: (parameters) =>
      `SELECT * FROM election_national_results('parliamentary', ${sqlCode(parameters.election, "election")}, NULL);`,
  },
  {
    id: "presidentialResults",
    questionId: "presidentialResults",
    version: 1,
    label: "Presidential election round",
    answers: "National CIK ticket results for one presidential cycle and round",
    purpose: "Elections & parliament",
    parameters: [
      {
        id: "cycle",
        kind: "enum",
        required: true,
        default: LATEST_PRESIDENTIAL_CONTEST,
        values: PRESIDENTIAL_CONTESTS,
      },
      {
        id: "round",
        kind: "integer",
        required: true,
        default: 2,
        min: ELECTION_ROUND_MIN,
        max: ELECTION_ROUND_MAX,
      },
    ],
    relations: ["election_national_results"],
    outputColumns: [
      "election_id",
      "contest_key",
      "election_type",
      "result_grain",
      "election_date",
      "round",
      "registered_voters",
      "actual_voters",
      "pct_denominator_votes",
      "none_of_above_votes",
      "invalid_votes",
      "percentage_basis",
      "choice_key",
      "choice_kind",
      "choice_number",
      "canonical_party_id",
      "president_name",
      "vice_president_name",
      "choice_name",
      "choice_short",
      "votes",
      "pct",
      "seats",
      "passed_threshold",
      "source_path",
      "source_sha256",
      "granular_source_path",
      "granular_sha256",
    ],
    build: (parameters) =>
      `SELECT * FROM election_national_results('presidential', ${sqlCode(parameters.cycle, "cycle")}, ${sqlInteger(parameters.round, "round", ELECTION_ROUND_MIN, ELECTION_ROUND_MAX)});`,
  },
  {
    id: "municipalFiscalRanking",
    questionId: "municipalFiscalRanking",
    version: 1,
    label: "Municipal financial indicators",
    answers:
      "Year-end commitments, expense obligations and arrears as separate Ministry of Finance measures",
    purpose: "Places",
    parameters: [
      {
        id: "year",
        kind: "year",
        required: true,
        default: MUNICIPAL_FISCAL_LATEST_VALIDATED_YEAR,
        min: MUNICIPAL_FISCAL_MIN_YEAR,
        max: MUNICIPAL_FISCAL_MAX_YEAR,
      },
      {
        id: "count",
        kind: "integer",
        required: false,
        default: 25,
        min: 1,
        max: MUNICIPAL_FISCAL_MAX_RESULTS,
      },
      {
        id: "metric",
        kind: "enum",
        required: true,
        default: "commitments",
        values: MUNICIPAL_FISCAL_METRICS,
      },
    ],
    relations: ["municipal_fiscal_ranking"],
    outputColumns: [
      "obshtina",
      "name_bg",
      "name_en",
      "fiscal_year",
      "quarter",
      "commitments_eur",
      "expense_obligations_eur",
      "arrears_eur",
      "debt_stock_eur",
      "meets_threshold",
      "criteria_evaluable",
    ],
    build: (parameters) => {
      const metric = String(parameters.metric) as MunicipalFiscalMetric;
      const orderColumn = {
        commitments: "commitments_eur",
        expense_obligations: "expense_obligations_eur",
        arrears: "arrears_eur",
      }[metric];
      return `-- Ministry of Finance year-end (Q4) municipal indicators.
-- The three liability stocks overlap and must not be added. NULL is unpublished, not zero.
SELECT obshtina, name_bg, name_en, fiscal_year, quarter,
       commitments_eur, expense_obligations_eur, arrears_eur, debt_stock_eur,
       meets_threshold, criteria_evaluable
FROM municipal_fiscal_ranking(${sqlInteger(parameters.year, "year", MUNICIPAL_FISCAL_MIN_YEAR, MUNICIPAL_FISCAL_MAX_YEAR)}, 1000)
ORDER BY ${orderColumn} DESC NULLS LAST, obshtina
LIMIT ${sqlInteger(parameters.count ?? 25, "count", 1, MUNICIPAL_FISCAL_MAX_RESULTS)};`;
    },
  },
  {
    id: "personWealth",
    questionId: "personWealth",
    version: 1,
    label: "Declared wealth by person",
    answers:
      "Assets, debts and net value declared to the Court of Audit; declared, not audited",
    purpose: "People & roles",
    parameters: [
      {
        id: "name",
        kind: "text",
        required: true,
        default: "Бойко Борисов",
      },
    ],
    relations: [
      "person_by_slug",
      "person_by_name",
      "person_search",
      "person_wealth_series",
    ],
    outputColumns: [
      "status",
      "matches",
      "name",
      "year",
      "assets_eur",
      "debts_eur",
      "net_eur",
      "filings",
    ],
    build: (
      parameters,
    ) => `-- Declared to the Court of Audit, not audited. Resolution status is explicit.
WITH direct AS MATERIALIZED (
  SELECT COALESCE(person_by_slug(${sqlText(parameters.name, "name")}),
                  person_by_name(${sqlText(parameters.name, "name")})) AS profile
), hit AS (
  SELECT profile->>'slug' AS slug, profile->>'name' AS name
  FROM direct WHERE profile->>'slug' IS NOT NULL
  UNION ALL
  SELECT candidate->>'slug', candidate->>'name'
  FROM direct, LATERAL jsonb_array_elements(
    CASE WHEN profile->>'slug' IS NULL
      THEN COALESCE(person_search(${sqlText(parameters.name, "name")}, 10), '[]'::jsonb)
      ELSE '[]'::jsonb END
  ) candidate
  WHERE candidate->>'slug' IS NOT NULL AND candidate->>'name' IS NOT NULL
), resolution AS (
  SELECT count(*)::int AS matches FROM hit
)
SELECT CASE WHEN r.matches = 0 THEN 'missing'
            WHEN r.matches > 1 THEN 'ambiguous'
            WHEN point IS NULL THEN 'no_data'
            ELSE 'ready' END AS status,
       r.matches, h.name, (point->>'year')::int AS year,
       (point->>'assetsEur')::numeric AS assets_eur,
       (point->>'debtsEur')::numeric AS debts_eur,
       (point->>'netEur')::numeric AS net_eur,
       (point->>'filings')::int AS filings
FROM resolution r
LEFT JOIN hit h ON r.matches = 1
LEFT JOIN LATERAL jsonb_array_elements(
  COALESCE(person_wealth_series(h.slug)->'series', '[]'::jsonb)
) AS point ON true
ORDER BY year NULLS FIRST;`,
  },
  {
    id: "topContractors",
    questionId: "topContractors",
    version: 1,
    label: "Top contractors",
    answers: "The same all-corpus contractor ranking used by chat",
    purpose: "Public money — who receives it",
    parameters: [],
    relations: ["contractor_rank"],
    outputColumns: ["eik", "name", "total_eur", "contract_count", "is_mp_tied"],
    build: () => `SELECT eik, name, total_eur, contract_count, is_mp_tied
FROM contractor_rank
WHERE scope_key = 'all' AND division = 'ALL'
ORDER BY total_eur DESC NULLS LAST, eik
LIMIT 12;`,
  },
  {
    id: "procurementAppeals",
    questionId: "procurementAppeals",
    version: 1,
    label: "Procurement appeals summary",
    answers: "The same КЗК summary used by chat",
    purpose: "Risk & competition",
    parameters: [],
    relations: ["kzk_appeals_summary_cache"],
    outputColumns: ["summary"],
    build: () => `SELECT r AS summary FROM kzk_appeals_summary_cache;`,
  },
  {
    id: "companyConnections",
    questionId: "companyConnections",
    version: 1,
    label: "Company political connections",
    answers: "The same political-links record used by chat",
    purpose: "Companies & ownership",
    parameters: [
      { id: "company", kind: "code", required: true, default: "831646048" },
    ],
    relations: ["company_political_links"],
    outputColumns: ["connections"],
    build: ({ company }) =>
      `SELECT company_political_links(${sqlCode(company, "company")}, 25) AS connections;`,
  },
];

export const SQL_RECIPES = [
  ...LEGACY_SQL_RECIPES,
  ...CHAT_SQL_RECIPES,
  ...EXPANDED_SQL_RECIPES,
];
export const SQL_RECIPES_BY_ID = new Map(
  SQL_RECIPES.map((recipe) => [recipe.id, recipe]),
);

/** Every published `/db?q=` ID remains a valid alias. */
export const LEGACY_SQL_ALIASES = new Map(
  SQL_RECIPES.map((recipe) => [recipe.id, recipe.id]),
);
