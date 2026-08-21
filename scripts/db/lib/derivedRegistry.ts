// The derived-object dependency registry — the catalog behind the chain-aware
// deploy resolver (docs/plans/cloud-deploy-speed-v1.md §v2.2 / §v2-c).
//
// WHY. A "derived object" (a matview, a rebuilt cache table, a committed artifact
// generated from Postgres) sits DOWNSTREAM of several base datasets and is rebuilt
// by one or more loaders. Today those dependencies live only in prose (CLAUDE.md's
// per-loader trigger lists) and in the loader bodies themselves, so a publish
// triggered by ONE changed dataset fans out to ~7 cloud loaders that each
// re-refresh the SAME shared caches — measured at ~22% of a procurement publish
// (cloud-deploy-speed-v1 F25). The resolver (v2-d) reads this catalog to rebuild
// each object AT MOST ONCE, in dependency order.
//
// SCOPE — DATA ONLY. Nothing consumes this yet: v2-d (the resolver) and v2-e
// (resolver-driven Step-8 emission) will read it; the existing loaders are NOT
// rewired here. Its value today is (1) the dependency graph as VERIFIABLE code
// rather than scattered prose, and (2) the R1 sync-class classification the
// delta-ship (Phase 3) needs to avoid destroying accumulator tables.
//
// This GENERALISES scripts/db/lib/scopedMatviews.ts — the same {name, inputs}
// shape, widened from the four per-scope precomputes to every derived object in the
// v2.2 dependency table. derivedRegistry.test.ts asserts the two agree on the four
// scoped matviews, so the narrow verified list and this wider one cannot drift.
//
// KEEPING IT HONEST. A migration that adds a derived object without a registry entry
// is invisible to the resolver and shows up only as a page serving stale numbers, so
// treat an addition here as mandatory when a new cache/matview lands. The `inputs`
// are the base tables the object is built FROM (a reload of any of them staleness the
// object); `rebuiltBy` is the npm script(s) that refresh it — base names, no `:cloud`,
// each asserted to exist in package.json.

/** A relation, cache table, or committed artifact derived from base data. */
export interface DerivedObject {
  /** the relation / committed artifact rebuilt */
  name: string;
  /** the migration that defines it, or "artifact" for a committed generated file */
  migration: string;
  /** the base tables it is built FROM — a reload of any of these stales it */
  inputs: string[];
  /** the npm script(s) that rebuild/refresh it (base names, no `:cloud`) */
  rebuiltBy: string[];
}

// The catalog, seeded from the v2.2 dependency table. `inputs` and `rebuiltBy` are
// traced from the loader bodies and CLAUDE.md's trigger lists, not assumed.
export const DERIVED_OBJECTS: DerivedObject[] = [
  // ── the money spine — the single reusable per-EIK money basis ───────────────
  // 127 is the one relation every money-corpus change (contracts/agri/funds/interreg)
  // must rebuild, and the head of the graph → tr-company-place → persons tail.
  {
    name: "company_public_money",
    migration: "127",
    inputs: [
      "contracts",
      "agri_subsidies",
      "fund_beneficiaries",
      "interreg_partners",
    ],
    rebuiltBy: ["db:load:graph:pg"],
  },
  {
    name: "graph_edge",
    migration: "128",
    inputs: ["person_role", "company_politicians", "company_public_money"],
    rebuiltBy: ["db:load:graph:pg"],
  },
  {
    name: "graph_payloads",
    migration: "129",
    inputs: ["person_role", "company_politicians", "company_public_money"],
    rebuiltBy: ["db:load:graph:pg"],
  },
  {
    name: "tr_company_place",
    migration: "133",
    // money_eur / political_n / person_link_n are denormalized from 127, 008 and
    // the gated person layer respectively.
    inputs: [
      "tr_companies",
      "company_public_money",
      "company_politicians",
      "person_role",
    ],
    rebuiltBy: ["db:load:tr-company-place:pg"],
  },

  // ── the person layer ────────────────────────────────────────────────────────
  {
    name: "person_browse_table",
    migration: "120",
    inputs: [
      "person_role",
      "person_wealth_year",
      "official_candidate_link",
      "judicial_body",
      "place_dim",
      "contracts",
      "tr_officers",
      "company_politicians",
    ],
    rebuiltBy: ["db:load:persons-browse:pg"],
  },
  {
    name: "person_search",
    migration: "126",
    inputs: [
      "person_browse_table",
      "tr_officers",
      "contracts",
      "agri_subsidies",
      "fund_beneficiaries",
    ],
    rebuiltBy: ["db:load:person-search:pg"],
  },

  // ── the per-scope procurement precomputes (must agree with scopedMatviews.ts) ─
  {
    name: "procurement_settlement_rank",
    migration: "119",
    inputs: ["contracts", "awarder_seats", "place_dim"],
    rebuiltBy: [
      "db:load:pg",
      "db:load:awarder-seats:pg",
      "db:load:place-dim:pg",
      "db:load:procurement-scopes:pg",
    ],
  },
  {
    name: "contractor_rank",
    migration: "122",
    inputs: ["contracts", "company_politicians", "tr_companies"],
    rebuiltBy: ["db:load:pg", "db:load:tr:pg", "db:load:procurement-scopes:pg"],
  },
  {
    name: "procurement_settlement_payloads",
    migration: "123",
    inputs: ["contracts", "awarder_seats", "place_dim"],
    rebuiltBy: [
      "db:load:pg",
      "db:load:awarder-seats:pg",
      "db:load:place-dim:pg",
      "db:load:procurement-scopes:pg",
    ],
  },
  {
    name: "procurement_payloads",
    migration: "124",
    inputs: [
      "contracts",
      "awarder_seats",
      "company_politicians",
      "tr_companies",
    ],
    rebuiltBy: [
      "db:load:pg",
      "db:load:awarder-seats:pg",
      "db:load:tr:pg",
      "db:load:procurement-scopes:pg",
    ],
  },

  // ── shared procurement caches rebuilt by MORE THAN ONE loader (the F1/F8 waste
  //    the resolver collapses to one rebuild each) ─────────────────────────────
  {
    name: "procurement_risk_indexes_cache",
    migration: "033",
    inputs: ["contracts", "company_politicians"],
    rebuiltBy: ["db:load:pg", "db:load:tr:pg"],
  },
  {
    name: "contract_risk_cache",
    migration: "112",
    // bit-12 nkidMismatch reads company_nkid; the kzk arm rebuilds via kzk:rejoin
    // (kzk_dependents → rebuild_contract_risk_cache), not the kzk-decisions loader.
    inputs: ["contracts", "kzk_decisions", "company_nkid"],
    rebuiltBy: ["db:load:pg", "kzk:rejoin"],
  },
  {
    name: "awarder_risk_grade_scoped",
    migration: "041",
    // The kzk-side rebuilder is kzk:rejoin (kzk_dependents.ts →
    // refreshAppealDependents → rebuildRiskGradeScoped), NOT db:load:kzk-decisions:pg,
    // which loads the merits corpus but does not refresh this leaderboard. load_pg.ts
    // names the same three callers (load_pg, load_tr_pg, the kzk ingest).
    inputs: ["contracts", "company_politicians", "kzk_appeals"],
    rebuiltBy: ["db:load:pg", "db:load:tr:pg", "kzk:rejoin"],
  },
  {
    name: "dual_corpus_rankings_cache",
    migration: "077",
    inputs: ["contracts", "fund_beneficiaries"],
    rebuiltBy: ["db:load:pg", "db:load:funds:pg"],
  },
  {
    name: "budget_admin_procurement",
    migration: "157",
    inputs: ["contracts", "company_politicians", "budget_admin_node"],
    rebuiltBy: ["db:load:pg", "db:load:tr:pg", "db:load:budget:pg"],
  },

  // ── funds ────────────────────────────────────────────────────────────────────
  {
    name: "funds_hub_stats_cache",
    migration: "145",
    inputs: ["fund_projects", "interreg_operations", "interreg_partners"],
    rebuiltBy: ["db:load:funds-fit:pg", "db:load:interreg:pg"],
  },
  {
    name: "fund_fit",
    migration: "143",
    inputs: ["fund_projects", "fund_payloads"],
    rebuiltBy: ["db:load:funds-fit:pg"],
  },

  // ── agri ─────────────────────────────────────────────────────────────────────
  {
    name: "agri_hub_stats_cache",
    migration: "162",
    inputs: [
      "agri_subsidies",
      "person_role",
      "fund_projects",
      "contracts",
      "budget_muni_transfer",
    ],
    rebuiltBy: ["db:load:agri-hub-stats:pg", "db:load:agri:pg"],
  },

  // ── TR-derived ────────────────────────────────────────────────────────────────
  {
    name: "company_person_roles",
    migration: "022",
    inputs: ["tr_person_roles", "tr_companies"],
    rebuiltBy: ["db:load:tr:pg"],
  },
  {
    name: "company_officer_counts",
    migration: "071",
    inputs: ["tr_officers", "tr_companies"],
    rebuiltBy: ["db:load:tr:pg", "db:load:magistrates:pg"],
  },

  // ── committed artifacts generated FROM Postgres (bucket-synced, no :cloud) ─────
  {
    name: "hub_stats.json",
    migration: "artifact",
    inputs: [
      "contracts",
      "tenders",
      "kzk_appeals",
      "awarder_seats",
      "ngo_funding",
    ],
    rebuiltBy: ["db:gen-hub-stats"],
  },
  {
    name: "sector_stats.json",
    migration: "artifact",
    inputs: ["contracts", "agri_payloads"],
    rebuiltBy: ["db:gen-sector-stats"],
  },
];

// ── R1 (F56): delta-ship sync class ────────────────────────────────────────────
// The Phase-3 delta-ship's DELETE arm (evict cloud keys absent from local) is SAFE
// on a MIRROR table — a full-corpus reload target where cloud == local after the
// load — and DESTRUCTIVE on an ACCUMULATOR — a table where cloud is a permanent
// SUPERSET of local, whether because the table is upsert-only or because its local
// source is partial (F56 measured council_resolution at 4,732 cloud vs 4,601 local,
// and it was CORRECT). A delta that DELETEd cloud keys missing from local would
// erase those rows, including the
// unregenerable kzk_appeals merits outcomes.
//
// The resolver / delta-ship reads this to decide whether the DELETE arm may run.
// A base table the delta-ship targets MUST be listed here; an omission is not a
// safe default (see derivedRegistry.test.ts, which requires the known accumulators
// to be present and classified).
export type SyncClass = "mirror" | "accumulator";

export const SYNC_CLASS: Record<string, SyncClass> = {
  // ACCUMULATOR — cloud ⊇ local, so the delta-DELETE arm is FORBIDDEN. Two distinct
  // mechanisms land a table here, both meaning "a local reload is not guaranteed to
  // be a superset of cloud":
  //   (a) UPSERT-ONLY, never-delete by design — council_resolution, open_calls,
  //       kzk_appeals (unregenerable outcomes), price_last_seen, person_slug_retired,
  //       and the magistrate roster (accumulates retained departed magistrates).
  //   (b) PARTIAL LOCAL SOURCE — ted_notice/ted_coverage reload from a gitignored
  //       ~73 MB export whose API index-ramp years are dropped, so local can hold
  //       fewer rows than cloud even though the loader itself TRUNCATE-reloads.
  // Either way, evicting cloud keys absent from local would destroy real rows.
  council_resolution: "accumulator", // (a) upsert-only
  open_calls: "accumulator", // (a) upsert-only
  kzk_appeals: "accumulator", // (a) upsert-only, unregenerable merits outcomes
  ted_notice: "accumulator", // (b) partial local source
  ted_coverage: "accumulator", // (b) partial local source
  price_last_seen: "accumulator", // (a) upsert-only
  person_slug_retired: "accumulator", // (a) upsert-only, accumulates per database
  magistrate: "accumulator", // (a) roster accumulates retained departed magistrates

  // MIRROR — full-corpus reload targets; cloud == local after the load, DELETE safe.
  contracts: "mirror",
  tenders: "mirror",
  tr_companies: "mirror",
  tr_officers: "mirror",
  tr_person_roles: "mirror",
  fund_beneficiaries: "mirror",
  fund_projects: "mirror",
  agri_subsidies: "mirror",
};

/** The base tables that are upsert-only accumulators — cloud is a permanent
 *  superset, so a delta-ship must NEVER run its DELETE arm against them. */
export const ACCUMULATOR_TABLES: string[] = Object.entries(SYNC_CLASS)
  .filter(([, c]) => c === "accumulator")
  .map(([t]) => t);
