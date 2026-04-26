import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ElectionSettlement } from "@/data/dataTypes";
import { settlementDataReader } from "scripts/dataReaders";

type SettlementMeta = {
  ekatte: string;
  oblast: string;
  name?: string;
  name_en?: string;
  t_v_m?: string;
};

type RegionMeta = {
  oblast: string;
  name?: string;
  name_en?: string;
};

let settlementMetaIndex: Map<string, SettlementMeta> | undefined;
let regionMetaIndex: Map<string, RegionMeta> | undefined;

const loadSettlementMeta = (): Map<string, SettlementMeta> => {
  if (settlementMetaIndex) return settlementMetaIndex;
  const __filename = fileURLToPath(import.meta.url);
  const file = path.resolve(
    path.dirname(__filename),
    "../../public/settlements.json",
  );
  const list: SettlementMeta[] = JSON.parse(fs.readFileSync(file, "utf-8"));
  settlementMetaIndex = new Map(list.map((s) => [s.ekatte, s]));
  return settlementMetaIndex;
};

const loadRegionMeta = (): Map<string, RegionMeta> => {
  if (regionMetaIndex) return regionMetaIndex;
  const __filename = fileURLToPath(import.meta.url);
  const file = path.resolve(
    path.dirname(__filename),
    "../../src/data/json/regions.json",
  );
  const list: RegionMeta[] = JSON.parse(fs.readFileSync(file, "utf-8"));
  regionMetaIndex = new Map(list.map((r) => [r.oblast, r]));
  return regionMetaIndex;
};

export const SUSPICIOUS_THRESHOLDS = {
  concentratedPct: 80,
  invalidBallotsPct: 10,
  additionalVotersPct: 10,
  // Floor on actual voters used by additional-voters: tiny settlements
  // produce huge percentages on a handful of additional voters, which
  // is rounding noise rather than a real signal.
  additionalVotersMinActual: 50,
};

const TOP_N = 3;
const ABROAD_OBLAST = "32";

export type SuspiciousTopSettlement = {
  ekatte: string;
  oblast: string;
  obshtina?: string;
  settlement?: string;
  settlement_en?: string;
  region_name?: string;
  region_name_en?: string;
  value: number;
  partyNum?: number;
  partyVotes?: number;
};

export type SuspiciousCategory = {
  count: number;
  threshold: number;
  top: SuspiciousTopSettlement[];
};

export type SuspiciousSettlementsReport = {
  election: string;
  thresholds: typeof SUSPICIOUS_THRESHOLDS;
  concentrated: SuspiciousCategory;
  invalidBallots: SuspiciousCategory;
  additionalVoters: SuspiciousCategory;
};

const round = (n: number, digits = 2) => {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
};

const buildBaseTop = (
  s: ElectionSettlement,
  value: number,
): SuspiciousTopSettlement => {
  const settlementMeta = loadSettlementMeta().get(s.ekatte);
  const regionMeta = loadRegionMeta().get(s.oblast);
  const tvm = s.t_v_m ?? settlementMeta?.t_v_m ?? "";
  return {
    ekatte: s.ekatte,
    oblast: s.oblast,
    obshtina: s.obshtina,
    settlement: `${tvm}${s.name ?? settlementMeta?.name ?? ""}`,
    settlement_en: settlementMeta?.name_en,
    region_name: regionMeta?.name ?? s.sections?.[0]?.region_name,
    region_name_en: regionMeta?.name_en,
    value: round(value),
  };
};

const computeConcentrated = (
  settlements: ElectionSettlement[],
): SuspiciousCategory => {
  const flagged: SuspiciousTopSettlement[] = [];
  for (const s of settlements) {
    if (s.oblast === ABROAD_OBLAST) continue;
    const protocol = s.results?.protocol;
    const totalValid =
      (protocol?.numValidVotes ?? 0) + (protocol?.numValidMachineVotes ?? 0);
    if (!totalValid) continue;
    let topVotes = 0;
    let topParty = -1;
    for (const v of s.results?.votes ?? []) {
      if (v.totalVotes > topVotes) {
        topVotes = v.totalVotes;
        topParty = v.partyNum;
      }
    }
    if (!topVotes) continue;
    const pct = (100 * topVotes) / totalValid;
    if (pct < SUSPICIOUS_THRESHOLDS.concentratedPct) continue;
    flagged.push({
      ...buildBaseTop(s, pct),
      partyNum: topParty,
      partyVotes: topVotes,
    });
  }
  flagged.sort((a, b) => b.value - a.value);
  return {
    count: flagged.length,
    threshold: SUSPICIOUS_THRESHOLDS.concentratedPct,
    top: flagged.slice(0, TOP_N),
  };
};

const computeInvalidBallots = (
  settlements: ElectionSettlement[],
): SuspiciousCategory => {
  const flagged: SuspiciousTopSettlement[] = [];
  for (const s of settlements) {
    if (s.oblast === ABROAD_OBLAST) continue;
    const protocol = s.results?.protocol;
    if (!protocol?.numPaperBallotsFound) continue;
    const pct =
      (100 * (protocol.numInvalidBallotsFound ?? 0)) /
      protocol.numPaperBallotsFound;
    if (pct < SUSPICIOUS_THRESHOLDS.invalidBallotsPct) continue;
    flagged.push(buildBaseTop(s, pct));
  }
  flagged.sort((a, b) => b.value - a.value);
  return {
    count: flagged.length,
    threshold: SUSPICIOUS_THRESHOLDS.invalidBallotsPct,
    top: flagged.slice(0, TOP_N),
  };
};

const computeAdditionalVoters = (
  settlements: ElectionSettlement[],
): SuspiciousCategory => {
  const flagged: SuspiciousTopSettlement[] = [];
  for (const s of settlements) {
    if (s.oblast === ABROAD_OBLAST) continue;
    const protocol = s.results?.protocol;
    if (!protocol?.totalActualVoters) continue;
    if (
      protocol.totalActualVoters <
      SUSPICIOUS_THRESHOLDS.additionalVotersMinActual
    ) {
      continue;
    }
    const pct =
      (100 * (protocol.numAdditionalVoters ?? 0)) / protocol.totalActualVoters;
    if (pct < SUSPICIOUS_THRESHOLDS.additionalVotersPct) continue;
    flagged.push(buildBaseTop(s, pct));
  }
  flagged.sort((a, b) => b.value - a.value);
  return {
    count: flagged.length,
    threshold: SUSPICIOUS_THRESHOLDS.additionalVotersPct,
    top: flagged.slice(0, TOP_N),
  };
};

export const generateSuspiciousSections = ({
  publicFolder,
  dataFolder,
  year,
  stringify,
}: {
  publicFolder: string;
  dataFolder: string;
  year: string;
  stringify: (o: object) => string;
}) => {
  const settlements = settlementDataReader(dataFolder, year);
  if (!settlements) return;
  const report: SuspiciousSettlementsReport = {
    election: year,
    thresholds: SUSPICIOUS_THRESHOLDS,
    concentrated: computeConcentrated(settlements),
    invalidBallots: computeInvalidBallots(settlements),
    additionalVoters: computeAdditionalVoters(settlements),
  };
  const dashboardFolder = `${publicFolder}/${year}/dashboard`;
  if (!fs.existsSync(dashboardFolder)) {
    fs.mkdirSync(dashboardFolder, { recursive: true });
  }
  const outFile = `${dashboardFolder}/suspicious_settlements.json`;
  fs.writeFileSync(outFile, stringify(report), "utf8");
  console.log(
    `Generated suspicious_settlements.json for ${year}: concentrated=${report.concentrated.count} invalid=${report.invalidBallots.count} additional=${report.additionalVoters.count}`,
  );
};
