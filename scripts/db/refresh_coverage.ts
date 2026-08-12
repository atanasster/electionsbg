// The single machine-readable home for "which local loaders does `db:refresh`
// deliberately NOT run, and why" — the other half of the coverage contract that
// `refresh_coverage.test.ts` enforces. Every local `db:load:*` / `db:resolve:*`
// script in package.json must be either referenced by `db:refresh` or listed
// here; adding a loader without deciding its side is a test failure, not a
// silent omission (docs/plans/db-refresh-loader-gaps-v1.md §1, §6).
//
// CLAUDE.md's runbook points here rather than duplicating the list.

/**
 * Why a loader is excluded. The axis matters more than the prose — §1a of the
 * gaps plan documents how five loaders were once mis-sorted by cost when the
 * operative constraint was a gitignored input:
 *   - "uncommitted-input": the loader reads a gitignored cache/corpus that a
 *     fresh clone does not have, and (unlike the absent-tolerant loaders in
 *     db:refresh) it either throws on absence or would load nothing useful;
 *   - "cost": the load is too heavy for the interactive full-refresh path.
 */
export type ExclusionAxis = "uncommitted-input" | "cost";

export interface RefreshExclusion {
  axes: ExclusionAxis[];
  /** What actually runs this loader (the operator path). */
  ranBy: string;
  reason: string;
}

export const REFRESH_EXCLUSIONS: Record<string, RefreshExclusion> = {
  "db:load:tr:pg": {
    axes: ["cost", "uncommitted-input"],
    ranBy:
      "the TR ingest path (update-connections / tr:daily-refresh), by hand",
    reason:
      "multi-hour load of ~1.02M companies; the TR corpus itself is not committed",
  },
  "db:load:tender-dossier:pg": {
    axes: ["uncommitted-input"],
    ranBy:
      "npx tsx scripts/procurement/ingest_eop_dossier.ts, by hand (CLAUDE.md, tender_dossier / migration 146 section)",
    reason:
      "reads the gitignored raw_data/procurement/eop_dossier.sqlite capture — absent on a fresh clone, and re-earning it is a ~26h crawl of a shared public register",
  },
  "db:load:cr-founding:pg": {
    axes: ["uncommitted-input"],
    ranBy: "npm run tr:daily-refresh (CLAUDE.md, CR Deeds section)",
    reason:
      "reads the gitignored raw_data/tr/cr_deeds.sqlite crawl cache — absent on a fresh clone",
  },
  "db:load:cr-nkid:pg": {
    axes: ["uncommitted-input"],
    ranBy: "npm run tr:daily-refresh (CLAUDE.md, CR Deeds / NKID §8 B1)",
    reason:
      "the company_nkid half reads the same gitignored raw_data/tr/cr_deeds.sqlite crawl cache — absent on a fresh clone. (The crosswalk tables it also seeds come from the committed src/lib/naceCpv.ts, but with an empty company_nkid the nkidMismatch flag is unavailable regardless, so seeding them in db:refresh would buy nothing.)",
  },
  "db:load:company-founded:pg": {
    axes: ["uncommitted-input"],
    ranBy: "the founding-date ingest, by hand (CLAUDE.md, CR Deeds section)",
    reason:
      "same gitignored cr_deeds.sqlite cache; also writes the http_status/attempts columns gated on migration 033",
  },
};

/**
 * Gitignored inputs read by loaders that ARE in `db:refresh`, declared so the
 * coverage test can hold the second invariant (gaps plan T6.1a): every such
 * input must be handled by an absent-tolerant branch — the loader skips and
 * warns on a missing file instead of aborting the `&&`-chained refresh on a
 * fresh clone. The test shape-matches each loader's guard on the declared
 * path (`if (!existsSync(CONST)) … return`, no throw), so both dropping the
 * branch AND reverting it to a throw go red here rather than resurfacing as a
 * cold-clone abort. Tracked inputs
 * are deliberately NOT listed: a tracked file cannot legitimately be absent,
 * and vanishing is a real defect that SHOULD throw. Scope is the loaders the
 * gaps plan touched, not general static analysis.
 *
 * `db:load:nzok-hospital:pg` is the special case with no input file at all: it
 * re-derives its corpus from nhif.bg on every run, so its absent-input case is
 * "network unreachable" — handled by the `--tolerate-offline` flag the
 * db:refresh chain passes (skip-before-write), not by a path listed here.
 * `db:load:ngo-funding:pg` additionally skips-before-write when `tr_companies`
 * is absent (its EIK match joins that table, and db:load:tr:pg is excluded).
 */
export const TOLERATED_GITIGNORED_INPUTS: Record<string, string[]> = {
  "db:load:agri:pg": ["raw_data/agri"],
  "db:load:nzok-tariffs:pg": ["data/budget/nzok/pathway_tariffs.json"],
  "db:load:nzok-activities:pg": ["data/budget/nzok/activities.json"],
  "db:load:nzok-drug-prices:pg": ["data/budget/nzok/drug_unit_prices.json"],
  "db:load:nzok-financials:pg": ["data/budget/nzok/hospital_financials.json"],
  "db:load:ngo-funding:pg": ["raw_data/ngo_funding/fts"],
  // A db:gen-* generator, not a loader — same contract, see REFRESH_GENERATORS.
  "db:gen-sector-stats": ["data/budget/ministries"],
};

/**
 * The `db:gen-*` half of the coverage contract (cross-source-dedup-v2 §T5).
 *
 * `db:load:*` is not the only way a committed artifact goes stale. `gen_procurement/`
 * holds NINE npm entry points, and they split cleanly in two:
 *
 *   - seven PARITY VERIFIERS (rollups, contract_lists, month_shards, derived,
 *     cross_reference, index, by_ns) — sql-migration-v1 leftovers that re-derive the
 *     JSON pipeline from Postgres and assert it matches byte-for-byte. Each gates its
 *     write behind `process.argv.includes("--write")`, so a default run writes NOTHING.
 *     They are correctly absent from db:refresh: they verify, they do not build.
 *   - two GENERATORS — hub_stats and sector_stats. No JSON-pipeline counterpart, no
 *     `--write` gate: every run overwrites a COMMITTED, bucket-synced artifact from
 *     whatever the database currently holds.
 *
 * Only the second kind can drift, and both did — silently, from 2026-06 until they were
 * regenerated by hand on 2026-08-04 (6a4bdda9ed). Nothing had run them since; a
 * contracts/tenders/agri/ngo reload moved the corpus underneath two files that kept
 * serving the old numbers at a 200.
 *
 * Widening the gate's regex to all of `db:gen-*` would be the wrong fix — it flags the
 * seven verifiers and buys seven meaningless exclusion entries. The honest axis is
 * "writes a committed artifact from Postgres", which is what this registry names and
 * what the `--write` idiom discriminates mechanically, so a NEW generator dropped into
 * gen_procurement/ cannot quietly land outside the chain.
 */
export interface RefreshGenerator {
  /** The committed artifact it writes, repo-relative. Asserted git-tracked. */
  artifact: string;
  /** Why it must be in the chain, and what pins its position there. */
  reason: string;
}

export const REFRESH_GENERATORS: Record<string, RefreshGenerator> = {
  "db:gen-hub-stats": {
    artifact: "data/procurement/derived/hub_stats.json",
    reason:
      "the nine /procurement hub stat-tile numbers; five of them (tenders, appeals, ngos, flags, places) come from tables loaded across the whole chain, so it sits after db:load:ngo-funding:pg — the last of them",
  },
  "db:gen-sector-stats": {
    artifact: "data/procurement/derived/sector_stats.json",
    reason:
      "the /governance/sectors hub headline per sector; its agri payout reads agri_payloads (db:load:agri:pg), so it must follow that loader",
  },
  "db:gen-declarations-hub-stats": {
    artifact: "data/governance/declarations_hub_stats.json",
    reason:
      "the six /governance/declarations tile figures; its `people` field is person_browse_table's tier='P' floor (the basis /persons itself lists), so it must follow db:load:persons-browse:pg — every other field reads a matview that loader's predecessors build",
  },
};
