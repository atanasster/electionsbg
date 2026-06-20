// Slim national red-flag feed for the /procurement/flags page + the
// procurementRedFlags AI tool. Pre-selects the top-N rows of each signal from
// the already-built derived files so the page loads ~8 KB instead of the full
// awarder_concentration.json (≈1 MB) + mp_connected.json. Debarred stays on its
// own tiny file (4 KB, shared with the risk scorer).

import fs from "fs";
import path from "path";
import type { AwarderConcentrationFile, MpConnectedFile } from "./types";
import { canonicalJson } from "./validate";

const TOP_N = 50;

export interface RiskFeedConcentration {
  awarderEik: string;
  awarderName: string;
  contractorEik: string;
  contractorName: string;
  sharePct: number;
  pairTotalEur: number;
}

export interface RiskFeedMpTied {
  mpId: number;
  mpName: string;
  contractorEik: string;
  contractorName: string;
  totalEur: number;
}

export interface RiskFeedFile {
  generatedAt: string;
  topConcentration: RiskFeedConcentration[];
  topMpTied: RiskFeedMpTied[];
}

export const buildRiskFeed = (derivedDir: string): RiskFeedFile => {
  const concPath = path.join(derivedDir, "awarder_concentration.json");
  const mpPath = path.join(derivedDir, "mp_connected.json");

  const conc: AwarderConcentrationFile = fs.existsSync(concPath)
    ? JSON.parse(fs.readFileSync(concPath, "utf8"))
    : { entries: [] as AwarderConcentrationFile["entries"] };
  const mp: MpConnectedFile = fs.existsSync(mpPath)
    ? JSON.parse(fs.readFileSync(mpPath, "utf8"))
    : { entries: [] as MpConnectedFile["entries"] };

  const topConcentration: RiskFeedConcentration[] = [...conc.entries]
    .sort((a, b) => b.sharePct - a.sharePct)
    .slice(0, TOP_N)
    .map((e) => ({
      awarderEik: e.awarderEik,
      awarderName: e.awarderName,
      contractorEik: e.contractorEik,
      contractorName: e.contractorName,
      sharePct: e.sharePct,
      pairTotalEur: e.pairTotalEur,
    }));

  const topMpTied: RiskFeedMpTied[] = [...mp.entries]
    .filter((e) => e.totalEur > 0)
    .sort((a, b) => b.totalEur - a.totalEur)
    .slice(0, TOP_N)
    .map((e) => ({
      mpId: e.mpId,
      mpName: e.mpName,
      contractorEik: e.contractorEik,
      contractorName: e.contractorName,
      totalEur: e.totalEur,
    }));

  return {
    generatedAt: new Date().toISOString(),
    topConcentration,
    topMpTied,
  };
};

export const writeRiskFeed = (derivedDir: string, data: RiskFeedFile): void => {
  fs.mkdirSync(derivedDir, { recursive: true });
  fs.writeFileSync(
    path.join(derivedDir, "risk_feed.json"),
    canonicalJson(data),
  );
};

// Slim per-person procurement index for the /procurement/people scanner: one
// row per MP with the euro total + supplier/contract counts, so the scanner
// loads ~5 KB instead of the full mp_connected.json.
export interface PersonIndexRow {
  mpId: number;
  mpName: string;
  totalEur: number;
  contractorCount: number;
  contractCount: number;
}

export interface PersonIndexFile {
  generatedAt: string;
  total: number;
  rows: PersonIndexRow[];
}

export const buildPersonIndex = (derivedDir: string): PersonIndexFile => {
  const mpPath = path.join(derivedDir, "mp_connected.json");
  const mp: MpConnectedFile = fs.existsSync(mpPath)
    ? JSON.parse(fs.readFileSync(mpPath, "utf8"))
    : { entries: [] as MpConnectedFile["entries"] };

  const byMp = new Map<number, PersonIndexRow>();
  for (const e of mp.entries) {
    const row = byMp.get(e.mpId) ?? {
      mpId: e.mpId,
      mpName: e.mpName,
      totalEur: 0,
      contractorCount: 0,
      contractCount: 0,
    };
    row.totalEur += e.totalEur;
    row.contractorCount += 1;
    row.contractCount += e.contractCount;
    byMp.set(e.mpId, row);
  }
  const rows = [...byMp.values()].sort((a, b) => b.totalEur - a.totalEur);
  return { generatedAt: new Date().toISOString(), total: rows.length, rows };
};

export const writePersonIndex = (
  derivedDir: string,
  data: PersonIndexFile,
): void => {
  fs.mkdirSync(derivedDir, { recursive: true });
  fs.writeFileSync(
    path.join(derivedDir, "person_procurement_index.json"),
    canonicalJson(data),
  );
};
