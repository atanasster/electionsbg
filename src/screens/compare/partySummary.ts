import {
  CandidatesInfo,
  ElectionRegion,
  PartyInfo,
  PartyResultsRow,
  RegionInfo,
  SettlementInfo,
  PreferencesInfo,
  PreferencesVotes,
} from "@/data/dataTypes";
import { NationalSummary } from "@/data/dashboard/dashboardTypes";
import { ProblemSectionsReport } from "@/data/reports/useProblemSections";

export type PartyTopRegion = {
  code: string;
  name: string;
  votes: number;
  pct: number;
};

export type PartyTopSettlement = {
  ekatte: string;
  name: string;
  obshtina: string;
  oblast: string;
  votes: number;
  pct: number;
};

export type PartyTopCandidate = {
  name: string;
  pref: string;
  oblast: string;
  votes: number;
};

export type PartySummary = {
  partyNum: number;
  nickName: string;
  name?: string;
  color?: string;
  // Result
  pct: number;
  totalVotes: number;
  seats: number;
  position: number; // rank 1, 2, ...
  passedThreshold: boolean;
  // Stronghold
  topRegion?: PartyTopRegion;
  topSettlement?: PartyTopSettlement;
  // Voting modality
  paperVotes?: number;
  machineVotes?: number;
  paperPct?: number;
  // Flash memory (national, machine - suemg). undefined if election has no flash data.
  suemgVotes?: number;
  flashDiff?: number;
  // Preferences
  preferencesTotal?: number;
  preferencesPct?: number; // share of party's votes that carried a preference
  topCandidate?: PartyTopCandidate;
  // Risk sections
  riskSectionsVotes?: number;
  riskSectionsPct?: number; // share of party's national votes coming from risk sections
  // Recount
  recountAdded?: number;
  recountRemoved?: number;
};

export type PartySummaryInputs = {
  partyNum: number;
  party: PartyInfo;
  national: NationalSummary;
  byRegion?: PartyResultsRow[] | null;
  bySettlement?: PartyResultsRow[] | null;
  preferenceStats?:
    | (PreferencesVotes & {
        history: Record<string, PreferencesVotes>;
        top?: PreferencesInfo[];
      })
    | undefined;
  candidates?: CandidatesInfo[];
  regions: RegionInfo[];
  findSettlement: (ekatte?: string) => SettlementInfo | undefined;
  countryVotes: ElectionRegion["results"]["votes"]; // aggregate party totals across regions
  problemSections?: ProblemSectionsReport | null;
  isBg: boolean;
};

const regionNameOf = (info: RegionInfo | undefined, isBg: boolean): string => {
  if (!info) return "";
  return isBg
    ? info.long_name || info.name
    : info.long_name_en || info.name_en || info.name;
};

const settlementNameOf = (
  info: SettlementInfo | undefined,
  isBg: boolean,
): string => {
  if (!info) return "";
  return isBg ? info.name : info.name_en || info.name;
};

const pickTopRegion = (
  rows: PartyResultsRow[] | null | undefined,
  regions: RegionInfo[],
  isBg: boolean,
): PartyTopRegion | undefined => {
  if (!rows?.length) return undefined;
  const regionByCode = new Map(regions.map((r) => [r.oblast, r]));
  let best: PartyResultsRow | undefined;
  let bestPct = -1;
  for (const r of rows) {
    if (!r.allVotes || !r.totalVotes) continue;
    if (!regionByCode.has(r.oblast)) continue; // skip oblasts not in the public list (e.g. NA)
    const pct = (100 * r.totalVotes) / r.allVotes;
    if (pct > bestPct) {
      bestPct = pct;
      best = r;
    }
  }
  if (!best) return undefined;
  return {
    code: best.oblast,
    name: regionNameOf(regionByCode.get(best.oblast), isBg),
    votes: best.totalVotes,
    pct: bestPct,
  };
};

const pickTopSettlement = (
  rows: PartyResultsRow[] | null | undefined,
  findSettlement: (ekatte?: string) => SettlementInfo | undefined,
  isBg: boolean,
): PartyTopSettlement | undefined => {
  if (!rows?.length) return undefined;
  // To avoid noise from tiny villages, require at least 100 valid votes cast.
  const MIN_ALL_VOTES = 100;
  let best: PartyResultsRow | undefined;
  let bestPct = -1;
  for (const r of rows) {
    if (!r.ekatte) continue;
    if (!r.allVotes || r.allVotes < MIN_ALL_VOTES) continue;
    if (!r.totalVotes) continue;
    const pct = (100 * r.totalVotes) / r.allVotes;
    if (pct > bestPct) {
      bestPct = pct;
      best = r;
    }
  }
  if (!best) return undefined;
  const info = findSettlement(best.ekatte);
  return {
    ekatte: best.ekatte || "",
    name: settlementNameOf(info, isBg),
    obshtina: best.obshtina || "",
    oblast: best.oblast,
    votes: best.totalVotes,
    pct: bestPct,
  };
};

const aggregateRecount = (rows: PartyResultsRow[] | null | undefined) => {
  if (!rows?.length) return undefined;
  let added = 0;
  let removed = 0;
  let any = false;
  for (const r of rows) {
    if (!r.recount) continue;
    any = true;
    added += r.recount.addedVotes ?? 0;
    removed += r.recount.removedVotes ?? 0;
  }
  return any ? { added, removed } : undefined;
};

const aggregateRiskSections = (
  partyNum: number,
  problemSections: ProblemSectionsReport | null | undefined,
): number | undefined => {
  if (!problemSections?.neighborhoods?.length) return undefined;
  let total = 0;
  for (const n of problemSections.neighborhoods) {
    for (const s of n.sections) {
      const votes = s.results?.votes ?? [];
      for (const v of votes) {
        if (v.partyNum === partyNum) {
          total += v.totalVotes ?? 0;
        }
      }
    }
  }
  return total;
};

export const computePartySummary = (
  inputs: PartySummaryInputs,
): PartySummary => {
  const {
    partyNum,
    party,
    national,
    byRegion,
    bySettlement,
    preferenceStats,
    candidates,
    regions,
    findSettlement,
    countryVotes,
    problemSections,
    isBg,
  } = inputs;

  const sortedParties = [...national.parties].sort(
    (a, b) => b.totalVotes - a.totalVotes,
  );
  const partyResult = national.parties.find((p) => p.partyNum === partyNum);
  const position =
    sortedParties.findIndex((p) => p.partyNum === partyNum) + 1 || 0;

  const totalVotes = partyResult?.totalVotes ?? 0;

  const aggregateCountry = countryVotes.find((v) => v.partyNum === partyNum);
  const machineVotes = aggregateCountry?.machineVotes;
  const paperVotes = aggregateCountry?.paperVotes;
  const suemgVotes = aggregateCountry?.suemgVotes;
  const paperPct =
    paperVotes !== undefined && machineVotes !== undefined
      ? paperVotes + machineVotes > 0
        ? (100 * paperVotes) / (paperVotes + machineVotes)
        : 0
      : undefined;
  const flashDiff =
    machineVotes !== undefined && suemgVotes !== undefined
      ? machineVotes - suemgVotes
      : undefined;

  const topRegion = pickTopRegion(byRegion, regions, isBg);
  const topSettlement = pickTopSettlement(bySettlement, findSettlement, isBg);

  const recount = aggregateRecount(byRegion);

  // Preferences. The candidate's name lives in candidates.json; the candidate
  // typically appears across multiple oblasts, so aggregate by name to get the
  // true national preference leader.
  let preferencesTotal: number | undefined;
  let topCandidate: PartyTopCandidate | undefined;
  let preferencesPct: number | undefined;
  if (preferenceStats) {
    preferencesTotal = preferenceStats.totalVotes;
    if (totalVotes > 0 && preferencesTotal !== undefined) {
      preferencesPct = (100 * preferencesTotal) / totalVotes;
    }
    const top = preferenceStats.top;
    if (top?.length && candidates?.length) {
      const byName = new Map<
        string,
        { votes: number; pref: string; oblast: string }
      >();
      for (const t of top) {
        if (!t.oblast) continue;
        const c = candidates.find(
          (cand) =>
            cand.oblast === t.oblast &&
            cand.partyNum === t.partyNum &&
            cand.pref === t.pref,
        );
        if (!c) continue;
        const prev = byName.get(c.name);
        if (prev) {
          prev.votes += t.totalVotes;
        } else {
          byName.set(c.name, {
            votes: t.totalVotes,
            pref: t.pref,
            oblast: t.oblast,
          });
        }
      }
      let bestName: string | undefined;
      let bestVotes = -1;
      for (const [name, agg] of byName) {
        if (agg.votes > bestVotes) {
          bestVotes = agg.votes;
          bestName = name;
        }
      }
      if (bestName) {
        const agg = byName.get(bestName)!;
        topCandidate = {
          name: bestName,
          pref: agg.pref,
          oblast: agg.oblast,
          votes: agg.votes,
        };
      }
    }
  }

  const riskSectionsVotes = aggregateRiskSections(partyNum, problemSections);
  const riskSectionsPct =
    riskSectionsVotes !== undefined && totalVotes > 0
      ? (100 * riskSectionsVotes) / totalVotes
      : undefined;

  return {
    partyNum,
    nickName: party.nickName,
    name: isBg ? party.name : party.name_en || party.name,
    color: party.color,
    pct: partyResult?.pct ?? 0,
    totalVotes,
    seats: partyResult?.seats ?? 0,
    position,
    passedThreshold: !!partyResult?.passedThreshold,
    topRegion,
    topSettlement,
    paperVotes,
    machineVotes,
    paperPct,
    suemgVotes,
    flashDiff,
    preferencesTotal,
    preferencesPct,
    topCandidate,
    riskSectionsVotes,
    riskSectionsPct,
    recountAdded: recount?.added,
    recountRemoved: recount?.removed,
  };
};
