// Per-CPV-division competition baseline. For each 2-digit CPV division, what
// share of the contracts with a known bid count had exactly one bidder?
//
// This is the conditioning the corruption-risk literature (Fazekas/GTI) puts
// on the single-bidding flag: a single bid is a red flag in markets that are
// *normally* competitive, but expected (and meaningless) in markets that are
// structurally single-bid (utility monopolies, sole-source maintenance, etc.).
// The per-contract scorer (src/data/procurement/computeProcurementRisk.ts)
// reads this file to suppress the single-bidder flag in structurally
// single-bid divisions, avoiding a wall of false positives.
//
// Derives entirely from the contract corpus already on disk, so it runs in the
// ingest pipeline after the month-shards are written (alongside the other
// derived builders). Reads numberOfTenderers, which only carries signal once
// the bids.statistics fix in normalize.ts has re-normalised the bundles.

import fs from "fs";
import path from "path";
import type {
  Contract,
  CpvCompetitionDivision,
  CpvCompetitionFile,
} from "./types";
import { canonicalJson } from "./validate";

// Divisions at/above this single-bid share are treated as structurally
// single-bid; the per-contract single-bidder flag is suppressed for them.
const STRUCTURAL_SINGLE_BID_SHARE = 0.8;

interface DivisionAcc {
  contractCount: number;
  withBidData: number;
  singleBid: number;
}

export const buildCpvCompetition = (
  contractsDir: string,
): CpvCompetitionFile => {
  const acc = new Map<string, DivisionAcc>();
  if (fs.existsSync(contractsDir)) {
    // Same safe walk as buildRollups: only YYYY/ dirs + YYYY-MM.json shards,
    // skipping the sibling by-id/ tree (single objects, not arrays).
    for (const year of fs.readdirSync(contractsDir).sort()) {
      if (!/^\d{4}$/.test(year)) continue;
      const yearDir = path.join(contractsDir, year);
      if (!fs.statSync(yearDir).isDirectory()) continue;
      for (const file of fs.readdirSync(yearDir).sort()) {
        if (!/^\d{4}-\d{2}\.json$/.test(file)) continue;
        const rows = JSON.parse(
          fs.readFileSync(path.join(yearDir, file), "utf8"),
        ) as Contract[];
        for (const row of rows) {
          const division = row.cpv?.slice(0, 2);
          if (!division || !/^\d{2}$/.test(division)) continue;
          const a = acc.get(division) ?? {
            contractCount: 0,
            withBidData: 0,
            singleBid: 0,
          };
          a.contractCount += 1;
          if (typeof row.numberOfTenderers === "number") {
            a.withBidData += 1;
            if (row.numberOfTenderers === 1) a.singleBid += 1;
          }
          acc.set(division, a);
        }
      }
    }
  }

  const divisions: CpvCompetitionDivision[] = [...acc.entries()]
    .map(([division, a]) => ({
      division,
      contractCount: a.contractCount,
      withBidData: a.withBidData,
      singleBid: a.singleBid,
      singleBidShare: a.withBidData === 0 ? 0 : a.singleBid / a.withBidData,
    }))
    .sort((x, y) => x.division.localeCompare(y.division));

  return {
    generatedAt: new Date().toISOString(),
    structuralSingleBidShare: STRUCTURAL_SINGLE_BID_SHARE,
    divisions,
  };
};

export const writeCpvCompetition = (
  derivedDir: string,
  file: CpvCompetitionFile,
): void => {
  fs.mkdirSync(derivedDir, { recursive: true });
  fs.writeFileSync(
    path.join(derivedDir, "cpv_competition.json"),
    canonicalJson(file),
  );
};
