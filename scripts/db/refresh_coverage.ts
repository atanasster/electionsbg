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
  "db:load:budget:pg": {
    axes: ["uncommitted-input"],
    ranBy:
      "the budget ingest path (update-budget), by hand (docs/plans/budget-hub-v1.md T1)",
    reason:
      "the admin and programme grain lives in data/budget/reconciliation/ and " +
      "data/budget/ministries/, both gitignored (bulky regenerable shards, " +
      "bucket-shipped only) — measured, git ls-files returns 0 for each against 24 " +
      "and 55 files on a machine that has run the pipeline. NOT excluded on cost: " +
      "the corpus is ~2 MB and the load is seconds. NOTE it is NOT the only applier " +
      "of 152/153 — db:load:budget-muni:pg is in the chain and applies " +
      "152→153→154→157→155 — so a fresh clone HAS the budget tables and they are " +
      "EMPTY, including the committed KFP half, because this excluded loader is " +
      "the only thing that fills either (the 147_tender_search_text shape). " +
      "budget_pg_roundtrip.data.test.ts skips on that empty state rather than " +
      "erroring. refresh_coverage.test.ts holds the in-chain applier and its " +
      "order. (This note claimed the opposite until 2026-08-15, having been " +
      "written before T2/T3 shipped the second applier.)",
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
  // ⚠️ THIS ONE WAS A REFRESH_EXCLUSIONS MEMBER UNTIL 2026-08-28, AND THE AXIS WAS
  // MISREAD. Its exclusion cited "uncommitted-input" — but that axis is exactly what
  // this map exists to resolve, and the loader already had the skip-shaped guard it
  // asks for. What the exclusion was really pricing was the ~3.5h CRAWL
  // (crawl_declarations.ts), which is a different program: this loader only reads the
  // cache the crawl left behind, and is 2.45 s measured over 36,995 filings.
  //
  // Leaving it out was not neutral. `db:load:magistrates:pg` is in the chain and runs
  // `TRUNCATE magistrate CASCADE`; `magistrate_filing` cascades with it while
  // `magistrate_filing_asset` (PK (source_url, table_num, ord), NO FK) SURVIVES. So
  // every full refresh left 26,142 property rows standing beside a roster with
  // `real_estate_count_parsed` NULL on all 3,587 magistrates and `form_version` NULL
  // on 36,995 filings — and `test:data`, the chain's ONLY verification step, went red
  // at the very end on both counts. A guaranteed red at the end of every refresh
  // teaches people to ignore the one step that checks the corpus.
  "db:load:magistrate-filing-assets:pg": [
    "raw_data/judiciary/filing_cache.json",
  ],
  // db:load:nzok-tariffs:pg is deliberately ABSENT. pathway_tariffs.json used to
  // sit here, but it is now COMMITTED (9 KB, and not regenerable by a routine
  // fetch the way its former neighbours are — rebuilding it means re-parsing the
  // НРД contract PDF off nhif.bg). A tracked path in this map fails the gate
  // below, which is the correct signal: the loader no longer has a gitignored
  // input to tolerate.
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
  /**
   * The `bucket:sync:paths` argument that PUBLISHES the artifact, i.e. the
   * second half of the contract — and the half this registry lacked until
   * 2026-08-21, when `culture/derived/hub_stats.json` was found returning 404
   * two days after it was committed.
   *
   * Chain membership only guarantees the file on DISK is current. Every one of
   * these four is a static blob a `dataUrl()` fetch reads from GCS, so a
   * regenerated-and-committed artifact that nobody uploaded is not stale — it
   * is ABSENT, and the hub renders without its numbers at a 200.
   *
   * ⚠️ THE PUBLISH TRIGGER IS NOT THE OWNING SKILL'S TRIGGER, which is exactly
   * how both misses happened. `db:gen-culture-hub-stats` reads contracts,
   * tenders, fund_projects, agri_subsidies, person_role and interreg_partners —
   * so it is `db:refresh` (i.e. update-procurement) that moves it, while the
   * skill that owns `data/culture/` and names its sync is woken only by
   * nfc/ncf/dki watcher flips. The skill holding the PATH is never woken by the
   * thing that changes the CONTENT. Publishing from THIS registry, keyed on the
   * generator that ran, is what removes that coupling; do not push it back into
   * per-skill prose.
   *
   * A subtree is acceptable, but prefer the exact file: `bucket:sync:paths`
   * takes either, and a subtree argument re-walks siblings that did not move.
   */
  bucketPath: string;
}

export const REFRESH_GENERATORS: Record<string, RefreshGenerator> = {
  "db:gen-hub-stats": {
    artifact: "data/procurement/derived/hub_stats.json",
    reason:
      "the nine /procurement hub stat-tile numbers; five of them (tenders, appeals, ngos, flags, places) come from tables loaded across the whole chain, so it sits after db:load:ngo-funding:pg — the last of them",
    bucketPath: "procurement/derived/hub_stats.json",
  },
  "db:gen-sector-stats": {
    artifact: "data/procurement/derived/sector_stats.json",
    reason:
      "the /governance/sectors hub headline per sector; its agri payout reads agri_payloads (db:load:agri:pg), so it must follow that loader",
    bucketPath: "procurement/derived/sector_stats.json",
  },
  "db:gen-culture-hub-stats": {
    artifact: "data/culture/derived/hub_stats.json",
    reason:
      "the /culture hub's headline figures, which shipped as FROZEN STRINGS in the tile copy beside film figures the prerender interpolates — half the page self-updating and half not. It reads contracts, tenders, fund_projects, agri_subsidies, person_role AND interreg_partners, so its slot is after db:load:interreg:pg, the LAST loader in the chain: placed beside its two siblings (~40 steps earlier, after db:load:ngo-funding:pg) it would regenerate the ИСУН and Interreg arms from the previous vintage and commit them",
    bucketPath: "culture/derived/hub_stats.json",
  },
  "db:gen-governance-hub-stats": {
    artifact: "data/governance/hub_stats.json",
    reason:
      "the /governance hub's four KPI figures, seven tile metrics and four coverage rows. It is a FOLD, not an aggregate: every figure is the destination hub's OWN number, taken from that hub's serving function (budget_hub_stats, agri_hub_stats, council_overview), its payload row (fund_payloads kind='index') or its committed blob (procurement/derived/hub_stats.json, procurement/derived/sector_stats.json, parliament/votes/derived/hub_stats.json, governance/declarations_hub_stats.json). So its slot is LAST of the five generators — after db:gen-culture-hub-stats, which is itself after the final loader — because placed anywhere earlier it folds the PREVIOUS vintage of whichever sibling has not run yet, and two hubs one click apart then disagree",
    bucketPath: "governance/hub_stats.json",
  },
  "db:gen-home-flyover": {
    artifact: "data/home/flyover.json",
    reason:
      "the one object behind the home flyover band, the money-map article and the Remotion explainer: pre-projected geometry, three money layers by oblast, the buyer\u2192contractor flow matrix and the caption figures. Its slot is immediately AFTER db:gen-home-hub-stats, for two reasons that pull in the same direction \u2014 it reads `contracts`, `awarder_seats`, `tr_company_place`, `fund_projects` and `agri_subsidies`, so it must follow every loader that writes one (the binding one is db:load:tr-company-place:pg, the arcs' contractor side, which sits near the end of the chain); and its caption headline is READ OUT of data/home/hub_stats.json rather than recomputed, so running it BEFORE that generator would quote the previous vintage of a number the reader sees again on the tile one screen below \u2014 two figures on one screen, disagreeing by whatever the reload moved. \u26a0\ufe0f The three money layers are three TAPS and never a total \u2014 an \u0418\u0421\u0423\u041d-funded contract is in both fund_projects and contracts \u2014 and the arcs were 23.5% covered when this was written (2026-09-06), which `flows.coverage` states rather than hides",
    bucketPath: "home/flyover.json",
  },
  "db:gen-home-hub-stats": {
    artifact: "data/home/hub_stats.json",
    reason:
      "the global home's four pulse figures and its tile metrics. It is a FOLD of destination artifacts — governance/hub_stats.json (itself the last of the sibling folds), procurement/derived/hub_stats.json and data/macro.json — so its slot is LAST of all the generators, after db:gen-governance-hub-stats. Placed earlier it folds the previous vintage of whichever sibling has not run yet, and `/` and the page one click away then disagree. ⚠️ It reads NO Postgres: `/` is the entry page, so every figure on it has to be servable from a static object with no database behind it",
    bucketPath: "home/hub_stats.json",
  },
  "db:gen-home-price-events": {
    artifact: "data/home/price_events.json",
    reason:
      "the price half of the home feed, and the ONE generator here whose artifact is an INTERMEDIATE rather than a page's data. The retail corpus lives only in Postgres, while gen_home/feed.ts is required to build on a fresh clone with no database — so this measures, commits the measurements, and the feed's price adapter reads the file. It must therefore run BEFORE db:gen-home-feed, and after the prices ingest has loaded the day it is measuring. ⚠️ It is published to the bucket for INSPECTABILITY (it is the audit trail for what the 90-day replay accepted), not because a reader fetches it — no browser code reads this path",
    bucketPath: "home/price_events.json",
  },
  "db:gen-home-feed": {
    artifact: "data/home/feed.json",
    reason:
      "the global home's change feed. Its adapters read COMMITTED sources (the roll-call session index, the council shard tree, the open-calls snapshots, the election registry, macro.json with the Eurostat watcher state, the budget document index, the domestic-debt file and — for the price arm, whose corpus is Postgres-only — the data/home/price_events.json that db:gen-home-price-events commits just before it), so it needs no database — but it must follow every ingest that writes one of those, which is why it sits at the end of the chain beside its sibling. ⚠️ Its window ends at the maximum SOURCE vintage rather than at `now`, so two rebuilds of one corpus are byte-identical and a stalled pipeline cannot look fresh",
    bucketPath: "home/feed.json",
  },
  "db:gen-declarations-hub-stats": {
    artifact: "data/governance/declarations_hub_stats.json",
    reason:
      "the six /governance/declarations tile figures; its `people` field is person_browse_table's tier='P' floor (the basis /persons itself lists), so it must follow db:load:persons-browse:pg — every other field reads a matview that loader's predecessors build",
    bucketPath: "governance/declarations_hub_stats.json",
  },
};

/**
 * The OTHER kind of committed, bucket-served blob — the one `REFRESH_GENERATORS`
 * structurally cannot hold.
 *
 * That registry's axis is "a `db:gen-*` script writes a committed artifact FROM
 * POSTGRES", which is what `db:check-generated` iterates and what
 * `refresh_coverage.test.ts` proves is chain-built. `parliament/votes/derived/
 * hub_stats.json` is the same KIND of object — committed, bucket-served, read by
 * a hub, silently degrading when absent — and meets none of that description: it
 * is written by `rebuildDerived` from in-memory objects, not from PG, and it is
 * published by that script's own `--upload` list rather than by a sync the
 * orchestrator assembles.
 *
 * So it was invisible to the check, and it drifted exactly the way the two blobs
 * that check was written for drifted. Measured 2026-08-27: the bucket copy was
 * from **11 August** and carried none of `topGroups` / `otherGroups` /
 * `otherMembers` for any of the nine parliaments — the 2026-08-25 "the head ranks
 * the groups" commit regenerated and committed it, and nothing uploaded it,
 * because `rebuildDerived --upload` only runs on a roll-call INGEST and the
 * change was a code commit. The publish trigger is not the owning skill's
 * trigger; here it is not even the owning SCRIPT's trigger.
 *
 * ⚠️ IT COMPOUNDS, which is why this one is worth a registry of its own rather
 * than a note. `gen_governance/hub_stats.ts` reads this file FROM DISK as one of
 * its four siblings, so a stale bucket copy makes `/governance` and `/parliament`
 * — one click apart — disagree about the same parliament while both are green
 * locally.
 *
 * SCOPE, deliberately narrow. `rebuildDerived` uploads eleven more artifacts and
 * they are NOT registered here: none is a hub stat blob, they carry per-record
 * `computedAt` stamps that make a byte compare report drift on every rebuild
 * regardless of content (verified 2026-08-27 — the whole set differed from the
 * bucket on `computedAt` alone), and two of them are 8–12 MB, which a check that
 * runs on every orchestrator pass should not be downloading. The axis here is
 * "a HUB reads it", the same axis `REFRESH_GENERATORS` uses.
 */
export interface UploadPublishedArtifact {
  /** The committed artifact, repo-relative. Asserted git-tracked. */
  artifact: string;
  /** The `bucket:sync:paths` argument that publishes it. */
  bucketPath: string;
  /**
   * The script whose `--upload` list is the ONLY thing that normally publishes
   * this artifact, repo-relative. The gate reads this file and fails when it no
   * longer names the artifact — otherwise the entry quietly becomes a claim
   * about a publish path that has been deleted.
   */
  publisher: string;
  reason: string;
}

export const UPLOAD_PUBLISHED_ARTIFACTS: Record<
  string,
  UploadPublishedArtifact
> = {
  "parliament-hub-stats": {
    artifact: "data/parliament/votes/derived/hub_stats.json",
    bucketPath: "parliament/votes/derived/hub_stats.json",
    publisher: "scripts/parliament/derived/index.ts",
    reason:
      "the /parliament hub's per-NS figures AND the parliament arm of the /governance hub-of-hubs, which folds this file from disk. Published only by `rebuildDerived --upload`, i.e. only on a roll-call ingest — so any change to its SHAPE that is not accompanied by an ingest never reaches the bucket",
  },
};
