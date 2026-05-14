/**
 * Build the MP-by-declared-assets rollups consumed by the home, party and
 * candidate pages.
 *
 * For every per-MP file at /data/parliament/declarations/{mpId}.json:
 *   1. Pick the MOST RECENT declaration (highest declarationYear). Annual
 *      filings get +1 in declarationYear over their fiscal year, so this
 *      naturally prefers a 2025 annual filing over a 2024 vacate filing
 *      that was actually entered earlier.
 *   2. Sum valueEur across all asset rows (declarant + spouse), bucketed by
 *      MpAssetCategory. `debt` rows are tracked separately so net-worth =
 *      assets − debts.
 *   3. Find the next-most-recent declaration to compute year-over-year delta.
 *
 * Outputs:
 *   /data/parliament/mp-assets/{mpId}.json   — full per-MP rollup
 *   /data/parliament/assets-rankings.json    — top MPs (lifetime + per-NS)
 */

import fs from "fs";
import path from "path";
import type {
  MpAsset,
  MpAssetCategory,
  MpAssetCategoryRollup,
  MpAssetsRankingEntry,
  MpAssetsRankings,
  MpAssetsRollup,
  MpDeclaration,
} from "../../src/data/dataTypes";

const ALL_CATEGORIES: MpAssetCategory[] = [
  "real_estate",
  "vehicle",
  "cash",
  "bank",
  "receivable",
  "debt",
  "investment",
  "security",
];

const emptyByCategory = (): Record<MpAssetCategory, MpAssetCategoryRollup> => {
  const out = {} as Record<MpAssetCategory, MpAssetCategoryRollup>;
  for (const c of ALL_CATEGORIES) {
    out[c] = { count: 0, valuedCount: 0, totalEur: 0 };
  }
  return out;
};

type DeclarationTotals = {
  totalAssetsEur: number;
  totalDebtsEur: number;
  netWorthEur: number;
  byCategory: Record<MpAssetCategory, MpAssetCategoryRollup>;
};

const totalsForDeclaration = (decl: MpDeclaration): DeclarationTotals => {
  const byCategory = emptyByCategory();
  const assets: MpAsset[] = decl.assets ?? [];
  for (const a of assets) {
    const bucket = byCategory[a.category];
    if (!bucket) continue;
    bucket.count++;
    if (a.valueEur != null) {
      bucket.valuedCount++;
      bucket.totalEur += a.valueEur;
    }
  }
  // Treat the declarant's company shares (table 10) as a category too so
  // the totals match the existing "Business interests" panel and the
  // user-visible footer shows shares contributing to net worth.
  for (const stake of decl.ownershipStakes) {
    if (stake.table !== "10") continue;
    const bucket = byCategory.security; // fold into "securities" bucket
    bucket.count++;
    if (stake.valueEur != null) {
      bucket.valuedCount++;
      bucket.totalEur += stake.valueEur;
    }
  }
  let totalAssetsEur = 0;
  for (const c of ALL_CATEGORIES) {
    if (c === "debt") continue;
    totalAssetsEur += byCategory[c].totalEur;
  }
  const totalDebtsEur = byCategory.debt.totalEur;
  return {
    totalAssetsEur,
    totalDebtsEur,
    netWorthEur: totalAssetsEur - totalDebtsEur,
    byCategory,
  };
};

type MpIndexEntry = {
  id: number;
  name: string;
  currentPartyGroupShort: string | null;
  isCurrent: boolean;
  nsFolders: string[];
};

type ParliamentIndex = {
  mps: MpIndexEntry[];
};

const buildEntry = (
  mp: MpIndexEntry,
  rollup: MpAssetsRollup,
): MpAssetsRankingEntry => {
  const re = rollup.byCategory.real_estate;
  const delta = rollup.previous
    ? {
        previousYear: rollup.previous.year,
        absoluteEur: rollup.netWorthEur - rollup.previous.netWorthEur,
        pct:
          rollup.previous.netWorthEur !== 0
            ? ((rollup.netWorthEur - rollup.previous.netWorthEur) /
                Math.abs(rollup.previous.netWorthEur)) *
              100
            : null,
      }
    : null;
  return {
    mpId: mp.id,
    label: mp.name,
    partyGroupShort: mp.currentPartyGroupShort,
    isCurrent: mp.isCurrent,
    nsFolders: mp.nsFolders,
    latestDeclarationYear: rollup.latestDeclarationYear,
    totalAssetsEur: rollup.totalAssetsEur,
    totalDebtsEur: rollup.totalDebtsEur,
    netWorthEur: rollup.netWorthEur,
    realEstateCount: re.count,
    realEstateUnvalued: re.count - re.valuedCount,
    delta,
  };
};

export type BuildAssetsRankingsArgs = {
  publicFolder: string;
  stringify: (o: object) => string;
};

export const buildAssetsRankings = ({
  publicFolder,
  stringify,
}: BuildAssetsRankingsArgs): void => {
  const declDir = path.join(publicFolder, "parliament", "declarations");
  if (!fs.existsSync(declDir)) {
    console.warn(`[assets] ${declDir} not found — skipping`);
    return;
  }
  const indexPath = path.join(publicFolder, "parliament", "index.json");
  if (!fs.existsSync(indexPath)) {
    console.warn(`[assets] ${indexPath} not found — skipping`);
    return;
  }
  const idx: ParliamentIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  const mpById = new Map<number, MpIndexEntry>();
  for (const mp of idx.mps) mpById.set(mp.id, mp);

  const outDir = path.join(publicFolder, "parliament", "mp-assets");
  fs.mkdirSync(outDir, { recursive: true });

  const entries: MpAssetsRankingEntry[] = [];
  let written = 0;

  for (const file of fs.readdirSync(declDir)) {
    if (!file.endsWith(".json")) continue;
    const mpIdNum = Number(file.replace(/\.json$/, ""));
    if (!Number.isFinite(mpIdNum)) continue;
    const mp = mpById.get(mpIdNum);
    if (!mp) continue;
    const decls: MpDeclaration[] = JSON.parse(
      fs.readFileSync(path.join(declDir, file), "utf-8"),
    );
    if (decls.length === 0) continue;

    // Sort newest first by declarationYear, then filedAt as a tiebreaker
    // (multiple declaration types in the same calendar year — vacate vs
    // annual). Latest = first element after sort.
    const sorted = [...decls].sort((a, b) => {
      if (b.declarationYear !== a.declarationYear) {
        return b.declarationYear - a.declarationYear;
      }
      const af = a.filedAt ?? "";
      const bf = b.filedAt ?? "";
      return bf.localeCompare(af);
    });
    const latest = sorted[0];
    const totals = totalsForDeclaration(latest);

    // Skip MPs whose latest declaration produced literally zero across
    // every asset and debt category — they are noise on the leaderboard.
    if (totals.totalAssetsEur === 0 && totals.totalDebtsEur === 0) continue;

    let previous: MpAssetsRollup["previous"] = null;
    if (sorted.length > 1) {
      // Find the most recent prior declaration that covers a different fiscal
      // year (so we don't compare an Annual + a Vacate from the same year).
      const latestFiscalYear = latest.fiscalYear ?? latest.declarationYear;
      const prior = sorted.find(
        (d) => (d.fiscalYear ?? d.declarationYear) !== latestFiscalYear,
      );
      if (prior) {
        const t = totalsForDeclaration(prior);
        previous = {
          year: prior.fiscalYear ?? prior.declarationYear,
          totalAssetsEur: t.totalAssetsEur,
          netWorthEur: t.netWorthEur,
        };
      }
    }

    const rollup: MpAssetsRollup = {
      mpId: mp.id,
      name: mp.name,
      partyGroupShort: mp.currentPartyGroupShort,
      isCurrent: mp.isCurrent,
      nsFolders: mp.nsFolders,
      latestDeclarationYear: latest.declarationYear,
      fiscalYear: latest.fiscalYear,
      declarationType: latest.declarationType,
      sourceUrl: latest.sourceUrl,
      totalAssetsEur: totals.totalAssetsEur,
      totalDebtsEur: totals.totalDebtsEur,
      netWorthEur: totals.netWorthEur,
      previous,
      byCategory: totals.byCategory,
    };

    fs.writeFileSync(
      path.join(outDir, `${mp.id}.json`),
      stringify(rollup),
      "utf-8",
    );
    written++;

    entries.push(buildEntry(mp, rollup));
  }

  entries.sort((a, b) => b.netWorthEur - a.netWorthEur);

  // Per-NS slices: an MP appears in an NS if their nsFolders contains it.
  // No artificial cap — the /mp-assets page renders the full list with a
  // sortable table, and the dashboard tile already uses its own ROWS=5
  // slice. A previous 200-cap left the JSON misleadingly truncated for
  // anyone consuming it directly (713 MPs have rollups; only 200 were on
  // the wire).
  const nsSet = new Set<string>();
  for (const e of entries) for (const f of e.nsFolders) nsSet.add(f);
  const byNs: Record<string, { topMps: MpAssetsRankingEntry[] }> = {};
  for (const ns of nsSet) {
    byNs[ns] = {
      topMps: entries.filter((e) => e.nsFolders.includes(ns)),
    };
  }

  const rankings: MpAssetsRankings = {
    generatedAt: new Date().toISOString(),
    topMps: entries,
    byNs,
  };

  fs.writeFileSync(
    path.join(publicFolder, "parliament", "assets-rankings.json"),
    stringify(rankings),
    "utf-8",
  );

  console.log(
    `[assets] wrote ${written} per-MP rollup(s) and ${entries.length} ranking entries`,
  );
};
