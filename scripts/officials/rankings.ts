// The officials net-worth leaderboard, built from every per-slug declaration
// file on disk.
//
// Kept out of ./index.ts on purpose — that module calls run() at import time, so
// nothing else can import it. Two callers need this: the ingest, and any repair
// that rewrites shards without going near the network (./remerge_collision_slugs.ts).
// Duplicating it in the second would let the two leaderboards drift.
//
// `data/officials/assets-rankings.json` is not only the /officials/assets
// leaderboard: `useOfficial` resolves a profile from it and the sitemap
// enumerates it, so a declarant missing here is a soft-404, not a missing row.
// See ./rankings_selection.test.ts.

import fs from "fs";
import path from "path";
import type {
  OfficialAssetsRankingEntry,
  OfficialAssetsRankings,
  OfficialDeclaration,
  OfficialIndexEntry,
} from "../../src/data/dataTypes";
import {
  byRecency,
  latestAssetDeclaration,
  priorAssetDeclaration,
} from "../../src/lib/declarations";
import { ROOT, writeJson } from "./shared";

export const OUT_DIR = path.join(ROOT, "data", "officials");
export const DECL_DIR = path.join(OUT_DIR, "declarations");

/** Every slug with a declaration file on disk, including officials whose most
 *  recent filing predates the year a run targets. */
export const allDeclarationSlugs = (): string[] =>
  fs.existsSync(DECL_DIR)
    ? fs
        .readdirSync(DECL_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -".json".length))
        .sort()
    : [];

// Map an MpAsset rollup-friendly category total. Mirrors the MP-side
// build_assets_rankings math: net worth = sum of asset categories minus debt.
export const aggregateAssets = (
  assets: NonNullable<OfficialDeclaration["assets"]>,
): {
  totalAssetsEur: number;
  totalDebtsEur: number;
  netWorthEur: number;
  realEstateCount: number;
  realEstateUnvalued: number;
} => {
  let totalAssetsEur = 0;
  let totalDebtsEur = 0;
  let realEstateCount = 0;
  let realEstateUnvalued = 0;
  for (const a of assets) {
    const v = a.valueEur ?? 0;
    if (a.category === "debt") totalDebtsEur += v;
    else totalAssetsEur += v;
    if (a.category === "real_estate") {
      realEstateCount++;
      if (a.valueEur == null) realEstateUnvalued++;
    }
  }
  return {
    totalAssetsEur,
    totalDebtsEur,
    netWorthEur: totalAssetsEur - totalDebtsEur,
    realEstateCount,
    realEstateUnvalued,
  };
};

const readShard = (slug: string): OfficialDeclaration[] => {
  const file = path.join(DECL_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as OfficialDeclaration[];
  } catch {
    console.warn(`  [warn] unreadable ${file} — skipping`);
    return [];
  }
};

/** Net worth per official, from every shard on disk — not just the year a run
 *  targeted, so a backfill does not drop officials whose latest filing is
 *  older. With multiple years merged, the prior filing is a genuine earlier one,
 *  which is what the delta field has always claimed to compare against. */
export const buildRankingEntries = (
  indexEntries: readonly OfficialIndexEntry[],
): OfficialAssetsRankingEntry[] => {
  const indexEntryBySlug = new Map(indexEntries.map((e) => [e.slug, e]));
  const out: OfficialAssetsRankingEntry[] = [];
  for (const slug of allDeclarationSlugs()) {
    const indexEntry = indexEntryBySlug.get(slug);
    if (!indexEntry) continue;
    // Sorted ON READ, not trusted. latestAssetDeclaration takes the head of a
    // byRecency order, and the on-disk order was established by mergeDeclarations
    // on a PREVIOUS run — so a change to the comparator (it now leads on the period
    // a filing covers, not the year it was lodged) would otherwise only reach this
    // leaderboard after every per-slug file happened to be rewritten, and until
    // then /officials would rank on one order while /person served another.
    const decls = readShard(slug).sort(byRecency);
    if (decls.length === 0) continue;
    // Rank on the newest filing that DECLARES something, not simply the newest
    // one. An incompatibility filing carries no asset tables, so reading
    // decls[0] ranked 525 of 1495 officials at €0 while their real declarations
    // sat one row below.
    //
    // Fall back to the newest filing when NOTHING in the history declares assets
    // (46 executive officials): their totals are genuinely zero, and dropping the
    // row instead would take them out of this file — which is also the roster
    // `useOfficial` resolves a profile from and the sitemap enumerates, so they
    // would become soft-404s.
    const withAssets = latestAssetDeclaration(decls);
    const latest = withAssets ?? decls[0];
    const prior = withAssets ? priorAssetDeclaration(decls, withAssets) : null;
    const totals = aggregateAssets(latest.assets ?? []);
    let delta: OfficialAssetsRankingEntry["delta"] = null;
    if (prior) {
      const priorTotals = aggregateAssets(prior.assets ?? []);
      const abs = totals.netWorthEur - priorTotals.netWorthEur;
      const pct =
        priorTotals.netWorthEur === 0
          ? null
          : abs / Math.abs(priorTotals.netWorthEur);
      delta = {
        previousYear: prior.fiscalYear ?? prior.declarationYear,
        absoluteEur: abs,
        pct,
      };
    }
    out.push({
      slug,
      name: indexEntry.name,
      category: indexEntry.category,
      institution: indexEntry.institution,
      positionTitle: indexEntry.positionTitle,
      latestDeclarationYear: latest.declarationYear,
      totalAssetsEur: totals.totalAssetsEur,
      totalDebtsEur: totals.totalDebtsEur,
      netWorthEur: totals.netWorthEur,
      realEstateCount: totals.realEstateCount,
      realEstateUnvalued: totals.realEstateUnvalued,
      delta,
    });
  }
  // Slug tie-break keeps the order stable when two officials tie on value.
  return out.sort(
    (a, b) => b.netWorthEur - a.netWorthEur || a.slug.localeCompare(b.slug),
  );
};

/** Dashboard slim — the /governance OfficialsAssetsTile renders only the top 5,
 *  while /officials/assets and /officials/:slug keep using the full file. Cuts
 *  ~60 KB gzipped off every cold load. */
const SLIM_TOP_N = 50;

export const writeRankings = (
  rankingEntries: OfficialAssetsRankingEntry[],
  years: number[],
): void => {
  // No per-category index in the file: it was a full second copy of every row
  // (~1.1 MB, half the file), and the only consumer — the /officials/assets
  // filter — derives its subset from topOfficials by category in one pass.
  const rankings: OfficialAssetsRankings = {
    generatedAt: new Date().toISOString(),
    years,
    total: rankingEntries.length,
    topOfficials: rankingEntries,
  };
  writeJson(path.join(OUT_DIR, "assets-rankings.json"), rankings);
  writeJson(path.join(OUT_DIR, "assets-rankings-top.json"), {
    generatedAt: rankings.generatedAt,
    years: rankings.years,
    total: rankings.total,
    topOfficials: rankings.topOfficials.slice(0, SLIM_TOP_N),
  });
};
