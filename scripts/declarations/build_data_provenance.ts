/**
 * Build the per-NS data-provenance summary consumed by the dashboard
 * `MpConnectionsTile` footnote. For each parliament we report:
 *   - how many of its MPs have any declaration on file
 *   - what year window those latest filings span
 *   - the breakdown of "latest declaration year per MP"
 *
 * The footnote exists to make staleness visible: just-elected MPs of the
 * 52nd NS won't have filed as 52nd-NS members yet, so the "shared
 * companies" graph for that NS is necessarily based on the older filings
 * those people made as 49th/50th/51st-NS members or as private citizens
 * in between mandates.
 *
 * Output: /public/parliament/data-provenance.json
 */

import fs from "fs";
import path from "path";
import type {
  DataProvenanceFile,
  DataProvenanceScope,
  MpDeclaration,
} from "../../src/data/dataTypes";

type MpIndexEntry = {
  id: number;
  nsFolders: string[];
};
type ParliamentIndex = { mps: MpIndexEntry[] };

type LatestPerMp = {
  mpId: number;
  nsFolders: string[];
  latestYear: number;
};

/** True NS seat count, for the denominator in "X/Y MPs filed". The
 * parliament index only retains MPs who appear in the current NS's
 * parliament.bg roster — for any older NS we therefore know only the
 * carry-over MPs, typically a third of the body. Using `mpsInNs.length`
 * as the denominator would be tautological ("100% of the MPs we know
 * about have filed") and hide the gap. We hardcode 240 for the modern
 * era (NS 38+) so the displayed coverage reflects reality. */
const NS_SEAT_COUNT = 240;
const isModernNs = (ns: string): boolean => {
  const n = Number(ns);
  return Number.isFinite(n) && n >= 38;
};

const pickLatestYear = (decls: MpDeclaration[]): number | null => {
  if (decls.length === 0) return null;
  let best = -Infinity;
  for (const d of decls) if (d.declarationYear > best) best = d.declarationYear;
  return Number.isFinite(best) ? best : null;
};

export type BuildDataProvenanceArgs = {
  publicFolder: string;
  stringify: (o: object) => string;
};

export const buildDataProvenance = ({
  publicFolder,
  stringify,
}: BuildDataProvenanceArgs): void => {
  const declDir = path.join(publicFolder, "parliament", "declarations");
  const indexPath = path.join(publicFolder, "parliament", "index.json");
  if (!fs.existsSync(declDir) || !fs.existsSync(indexPath)) {
    console.warn(`[provenance] declarations or index missing — skipping`);
    return;
  }
  const idx: ParliamentIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  const mpById = new Map<number, MpIndexEntry>();
  for (const mp of idx.mps) mpById.set(mp.id, mp);

  const latestByMp = new Map<number, LatestPerMp>();
  for (const file of fs.readdirSync(declDir)) {
    if (!file.endsWith(".json")) continue;
    const mpIdNum = Number(file.replace(/\.json$/, ""));
    if (!Number.isFinite(mpIdNum)) continue;
    const mp = mpById.get(mpIdNum);
    if (!mp) continue;
    const decls: MpDeclaration[] = JSON.parse(
      fs.readFileSync(path.join(declDir, file), "utf-8"),
    );
    const latestYear = pickLatestYear(decls);
    if (latestYear == null) continue;
    latestByMp.set(mpIdNum, {
      mpId: mpIdNum,
      nsFolders: mp.nsFolders,
      latestYear,
    });
  }

  const computeScope = (
    mpsTotal: number,
    latests: LatestPerMp[],
  ): DataProvenanceScope => {
    let min: number | null = null;
    let max: number | null = null;
    const byCount: Record<string, number> = {};
    for (const l of latests) {
      if (min == null || l.latestYear < min) min = l.latestYear;
      if (max == null || l.latestYear > max) max = l.latestYear;
      const key = String(l.latestYear);
      byCount[key] = (byCount[key] ?? 0) + 1;
    }
    return {
      mpsTotal,
      mpsWithDeclaration: latests.length,
      declarationYearMin: min,
      declarationYearMax: max,
      latestDeclarationYearByCount: byCount,
    };
  };

  const all = computeScope(idx.mps.length, Array.from(latestByMp.values()));

  const allNsFolders = new Set<string>();
  for (const mp of idx.mps) for (const ns of mp.nsFolders) allNsFolders.add(ns);
  const byNs: Record<string, DataProvenanceScope> = {};
  for (const ns of allNsFolders) {
    const mpsInNs = idx.mps.filter((mp) => mp.nsFolders.includes(ns));
    const latestsInNs = mpsInNs
      .map((mp) => latestByMp.get(mp.id))
      .filter((x): x is LatestPerMp => x != null);
    const total = isModernNs(ns)
      ? Math.max(NS_SEAT_COUNT, mpsInNs.length)
      : mpsInNs.length;
    byNs[ns] = computeScope(total, latestsInNs);
  }

  const out: DataProvenanceFile = {
    generatedAt: new Date().toISOString(),
    source: "register.cacbg.bg + Commerce Registry",
    all,
    byNs,
  };
  fs.writeFileSync(
    path.join(publicFolder, "parliament", "data-provenance.json"),
    stringify(out),
    "utf-8",
  );
  const nsCount = Object.keys(byNs).length;
  console.log(
    `[provenance] wrote provenance for ${nsCount} NS scope(s): ` +
      `lifetime ${all.mpsWithDeclaration}/${all.mpsTotal} MPs filed ` +
      `(${all.declarationYearMin}–${all.declarationYearMax})`,
  );
};
