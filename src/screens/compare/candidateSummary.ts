import {
  CandidatesInfo,
  CandidateStats,
  PartyInfo,
  PreferencesInfo,
  RegionInfo,
  SettlementInfo,
} from "@/data/dataTypes";

export type CandidateRegionRow = {
  partyNum: number;
  oblast: string;
  pref: string;
  totalVotes: number;
  paperVotes?: number;
  machineVotes?: number;
  allVotes?: number;
  partyVotes?: number;
  partyPrefs?: number;
};

export type CandidateTopRegion = {
  code: string;
  name: string;
  votes: number;
  pct: number; // share of party's preferences in that oblast
};

export type CandidateTopSettlement = {
  ekatte: string;
  name: string;
  votes: number;
  pct: number; // share of party's preferences in that settlement
};

export type CandidateTopSection = {
  section: string;
  votes: number;
  pct: number; // share of party's preferences in that section
};

export type CandidatePastBest = {
  date: string;
  votes: number;
};

export type CandidateSummary = {
  name: string;
  party?: PartyInfo;
  oblastCodes: string[];
  oblastNames: string[];
  prefs: string[];
  // Result (current election)
  totalVotes: number;
  paperVotes?: number;
  machineVotes?: number;
  paperPct?: number;
  // Party context (across the candidate's own oblasts)
  partyPrefsTotal?: number;
  partyVotesTotal?: number;
  sharePartyPrefs?: number; // candidate prefs / party prefs in the same oblasts
  sharePartyVotes?: number; // candidate prefs / party votes in the same oblasts
  // Strongholds
  topRegion?: CandidateTopRegion;
  topSettlement?: CandidateTopSettlement;
  topSection?: CandidateTopSection;
  // History
  timesContested: number;
  pastBest?: CandidatePastBest;
};

export type CandidateSummaryInputs = {
  name: string;
  regionsRows?: CandidateRegionRow[] | null;
  prefStats?: CandidateStats | null;
  candidates?: CandidatesInfo[];
  findParty: (n: number) => PartyInfo | undefined;
  regionsInfo: RegionInfo[];
  findSettlement: (ekatte?: string) => SettlementInfo | undefined;
  currentElection: string | null | undefined;
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
  rows: CandidateRegionRow[] | null | undefined,
  regions: RegionInfo[],
  isBg: boolean,
): CandidateTopRegion | undefined => {
  if (!rows?.length) return undefined;
  const regionByCode = new Map(regions.map((r) => [r.oblast, r]));
  let best: CandidateRegionRow | undefined;
  for (const r of rows) {
    if (!r.totalVotes) continue;
    if (!best || r.totalVotes > best.totalVotes) best = r;
  }
  if (!best) return undefined;
  const pct =
    best.partyPrefs && best.partyPrefs > 0
      ? (100 * best.totalVotes) / best.partyPrefs
      : 0;
  return {
    code: best.oblast,
    name: regionNameOf(regionByCode.get(best.oblast), isBg),
    votes: best.totalVotes,
    pct,
  };
};

const pickTopSettlement = (
  rows: PreferencesInfo[] | undefined,
  findSettlement: (ekatte?: string) => SettlementInfo | undefined,
  isBg: boolean,
): CandidateTopSettlement | undefined => {
  if (!rows?.length) return undefined;
  const best = rows[0]; // already sorted desc by totalVotes
  if (!best?.ekatte) return undefined;
  const pct =
    best.partyPrefs && best.partyPrefs > 0
      ? (100 * best.totalVotes) / best.partyPrefs
      : 0;
  return {
    ekatte: best.ekatte,
    name: settlementNameOf(findSettlement(best.ekatte), isBg),
    votes: best.totalVotes,
    pct,
  };
};

const pickTopSection = (
  rows: PreferencesInfo[] | undefined,
): CandidateTopSection | undefined => {
  if (!rows?.length) return undefined;
  const best = rows[0];
  if (!best?.section) return undefined;
  const pct =
    best.partyPrefs && best.partyPrefs > 0
      ? (100 * best.totalVotes) / best.partyPrefs
      : 0;
  return {
    section: best.section,
    votes: best.totalVotes,
    pct,
  };
};

export const computeCandidateSummary = (
  inputs: CandidateSummaryInputs,
): CandidateSummary => {
  const {
    name,
    regionsRows,
    prefStats,
    candidates,
    findParty,
    regionsInfo,
    findSettlement,
    currentElection,
    isBg,
  } = inputs;

  // Identity — pull party / oblast / pref from the candidates roster (one row
  // per (oblast, pref) the candidate runs in).
  const roster = candidates?.filter((c) => c.name === name) ?? [];
  const partyNum = roster[0]?.partyNum;
  const party = partyNum !== undefined ? findParty(partyNum) : undefined;
  const oblastCodes = Array.from(new Set(roster.map((c) => c.oblast)));
  const prefs = Array.from(new Set(roster.map((c) => c.pref)));
  const regionByCode = new Map(regionsInfo.map((r) => [r.oblast, r]));
  const oblastNames = oblastCodes.map((code) =>
    regionNameOf(regionByCode.get(code), isBg),
  );

  // Result aggregates
  let totalVotes = 0;
  let paperVotes = 0;
  let machineVotes = 0;
  let hasPaper = false;
  let hasMachine = false;
  let partyPrefsTotal = 0;
  let partyVotesTotal = 0;
  let hasPartyPrefs = false;
  let hasPartyVotes = false;
  for (const r of regionsRows ?? []) {
    totalVotes += r.totalVotes ?? 0;
    if (r.paperVotes !== undefined) {
      paperVotes += r.paperVotes;
      hasPaper = true;
    }
    if (r.machineVotes !== undefined) {
      machineVotes += r.machineVotes;
      hasMachine = true;
    }
    if (r.partyPrefs !== undefined) {
      partyPrefsTotal += r.partyPrefs;
      hasPartyPrefs = true;
    }
    if (r.partyVotes !== undefined) {
      partyVotesTotal += r.partyVotes;
      hasPartyVotes = true;
    }
  }
  const paperPct =
    hasPaper && hasMachine && paperVotes + machineVotes > 0
      ? (100 * paperVotes) / (paperVotes + machineVotes)
      : undefined;
  const sharePartyPrefs =
    hasPartyPrefs && partyPrefsTotal > 0
      ? (100 * totalVotes) / partyPrefsTotal
      : undefined;
  const sharePartyVotes =
    hasPartyVotes && partyVotesTotal > 0
      ? (100 * totalVotes) / partyVotesTotal
      : undefined;

  const topRegion = pickTopRegion(regionsRows, regionsInfo, isBg);
  const topSettlement = pickTopSettlement(
    prefStats?.top_settlements,
    findSettlement,
    isBg,
  );
  const topSection = pickTopSection(prefStats?.top_sections);

  // History — count past elections (excluding current) where the candidate
  // received any preferences, and find the best past total.
  let timesContested = 0;
  let pastBest: CandidatePastBest | undefined;
  for (const yr of prefStats?.stats ?? []) {
    if (yr.elections_date === currentElection) continue;
    const sum = (yr.preferences ?? []).reduce(
      (a, p) => a + (p.preferences ?? 0),
      0,
    );
    if (sum > 0) {
      timesContested += 1;
      if (!pastBest || sum > pastBest.votes) {
        pastBest = { date: yr.elections_date, votes: sum };
      }
    }
  }

  return {
    name,
    party,
    oblastCodes,
    oblastNames,
    prefs,
    totalVotes,
    paperVotes: hasPaper ? paperVotes : undefined,
    machineVotes: hasMachine ? machineVotes : undefined,
    paperPct,
    partyPrefsTotal: hasPartyPrefs ? partyPrefsTotal : undefined,
    partyVotesTotal: hasPartyVotes ? partyVotesTotal : undefined,
    sharePartyPrefs,
    sharePartyVotes,
    topRegion,
    topSettlement,
    topSection,
    timesContested,
    pastBest,
  };
};
