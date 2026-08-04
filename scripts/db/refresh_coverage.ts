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
  "db:load:cr-founding:pg": {
    axes: ["uncommitted-input"],
    ranBy: "npm run tr:daily-refresh (CLAUDE.md, CR Deeds section)",
    reason:
      "reads the gitignored raw_data/tr/cr_deeds.sqlite crawl cache — absent on a fresh clone",
  },
  "db:load:company-founded:pg": {
    axes: ["uncommitted-input"],
    ranBy: "the founding-date ingest, by hand (CLAUDE.md, CR Deeds section)",
    reason:
      "same gitignored cr_deeds.sqlite cache; also writes the http_status/attempts columns gated on migration 033",
  },

  // ── INTERIM (gaps plan §1c) — these four join db:refresh in tier T1b, once
  // they skip-and-warn on their gitignored input instead of throwing. Until
  // then wiring them would abort a cold-clone refresh mid-chain, which is
  // worse than the omission. Remove each entry in the commit that wires it.
  "db:load:nzok-activities:pg": {
    axes: ["uncommitted-input"],
    ranBy: "update-nzok skill after the activities fetch",
    reason:
      "throws on the gitignored data/budget/nzok/activities.json — pending absent-tolerance (T1b)",
  },
  "db:load:nzok-drug-prices:pg": {
    axes: ["uncommitted-input"],
    ranBy: "update-nzok skill after the Справка 5 fetch",
    reason:
      "throws on the gitignored data/budget/nzok/drug_unit_prices.json — pending absent-tolerance (T1b)",
  },
  "db:load:nzok-financials:pg": {
    axes: ["uncommitted-input"],
    ranBy: "update-nzok skill after the ЕЕОФ fetch",
    reason:
      "throws on the gitignored data/budget/nzok/hospital_financials.json — pending absent-tolerance (T1b)",
  },
  "db:load:ngo-funding:pg": {
    axes: ["uncommitted-input"],
    ranBy: "the NGO funding ingest, by hand",
    reason:
      "unguarded CREATE INDEX on tr_companies (42P01 on a TR-less database) + gitignored FTS dir — pending T1b's guard",
  },
};

/**
 * Gitignored inputs read by loaders that are in `db:refresh` — or pending T1b
 * wiring (the interim exclusions above) — declared so the coverage test can
 * hold the second invariant (gaps plan T6.1a): every such input must be
 * handled by an absent-tolerant branch — the loader skips and warns on a
 * missing file instead of aborting the `&&`-chained refresh on a fresh clone.
 * For the interim-excluded four, the entry states the CONTRACT their T1b
 * change must satisfy before they may join the chain. Tracked inputs are
 * deliberately NOT listed: a tracked file cannot legitimately be absent, and
 * vanishing is a real defect that SHOULD throw. Scope is the loaders the gaps
 * plan touched, not general static analysis.
 *
 * `db:load:nzok-hospital:pg` is the special case with no input file at all: it
 * re-derives its corpus from nhif.bg on every run, so its absent-input case is
 * "network unreachable" — handled by the `--tolerate-offline` flag the
 * db:refresh chain passes (skip-before-write), not by a path listed here.
 */
export const TOLERATED_GITIGNORED_INPUTS: Record<string, string[]> = {
  "db:load:nzok-tariffs:pg": ["data/budget/nzok/pathway_tariffs.json"],
  "db:load:nzok-activities:pg": ["data/budget/nzok/activities.json"],
  "db:load:nzok-drug-prices:pg": ["data/budget/nzok/drug_unit_prices.json"],
  "db:load:nzok-financials:pg": ["data/budget/nzok/hospital_financials.json"],
  "db:load:ngo-funding:pg": ["raw_data/ngo_funding/fts"],
};
