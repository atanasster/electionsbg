/**
 * Bundles every relevant data point for ONE party in ONE election into a single
 * compact JSON, ready to feed to an LLM for a campaign retrospect.
 *
 * Output: prints the bundle to stdout (so a skill can `node -e ...` or the
 * generate_retrospect.ts script can pipe it directly).
 *
 * Data sources (per party):
 *   - public/elections.json                              → election metadata
 *   - public/{election}/cik_parties.json                 → party info, color
 *   - public/{election}/national_summary.json            → national context, turnout, anomalies
 *   - public/{election}/region_votes.json                → regional split (current)
 *   - public/{prior}/region_votes.json                   → prior regional split
 *   - public/{election}/parties/by_region/{N}.json       → per-region for THIS party
 *   - public/{election}/parties/by_municipality/{N}.json → per-municipality
 *   - public/{election}/parties/by_settlement/{N}.json   → per-settlement
 *   - public/{election}/parties/financing/{N}/filing.json (optional)
 *   - public/polls/polls.json + polls_details.json + accuracy.json (optional)
 *   - public/{election}/parties/preferences/{N}/{regions,stats}.json (optional)
 *   - public/{election}/candidates.json                  → candidate names for prefs
 *   - public/{election}/problem_sections.json            → risk-neighborhood sections
 *   - public/{prior}/problem_sections.json               → prior risk-section party votes
 *   - public/{election}/reports/section/{suemg,recount,concentrated}.json → anomaly attribution
 *
 * Usage:
 *   tsx scripts/parties/bundle_party_data.ts --election 2024_10_27 --party 18
 *   tsx scripts/parties/bundle_party_data.ts --election 2024_10_27 --party 18 --out /tmp/bundle.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, option, string, optional } from "cmd-ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, "../../public");
const ELECTIONS_INDEX = path.resolve(
  __dirname,
  "../../src/data/json/elections.json",
);

// Region groupings used for geographic narrative slices.
// Sofia City = the three urban Sofia constituencies (the rural province is SFO).
// Big cities = Plovdiv-city / Varna / Burgas (the three other major urban centers).
// Abroad = oblast 32 (out-of-country sections).
// Ethnic-mixed = oblasts with significant Turkish/Pomak populations, where DPS-family
// parties have historically over-indexed. Used as a single aggregate, not as
// causal claims about individual voters.
const SOFIA_CITY_OBLASTS = ["S23", "S24", "S25"];
const OTHER_BIG_CITY_OBLASTS = ["PDV-00", "VAR", "BGS"];
const ABROAD_OBLAST = "32";
const ETHNIC_MIXED_OBLASTS = [
  "KRZ",
  "RAZ",
  "TGV",
  "SLS",
  "SHU",
  "BLG",
  "HKV",
  "SML",
];

type ElectionInfo = {
  name: string;
  hasFinancials?: boolean;
  hasPreferences?: boolean;
  hasRecount?: boolean;
  results?: {
    votes: {
      number: number;
      partyNum: number;
      nickName: string;
      commonName?: string[];
      totalVotes: number;
      paperVotes?: number;
      machineVotes?: number;
    }[];
  };
};

type PartyInfo = {
  number: number;
  name: string;
  nickName: string;
  color?: string;
  name_en?: string;
  commonName?: string[];
};

type Region = {
  oblast: string;
  name?: string;
  name_en?: string;
};

type PartyResultsRow = {
  oblast?: string;
  obshtina?: string;
  ekatte?: string;
  position: number;
  totalVotes: number;
  machineVotes?: number;
  paperVotes?: number;
  allVotes: number;
  prevYearVotes?: number;
  prevYearVotesConsolidated?: number;
};

type SectionVote = {
  partyNum: number;
  totalVotes: number;
  paperVotes?: number;
  machineVotes?: number;
};

type ProblemSection = {
  section: string;
  oblast?: string;
  obshtina?: string;
  ekatte?: string;
  results?: {
    votes?: SectionVote[];
  };
};

type ProblemNeighborhood = {
  id: string;
  name_bg: string;
  name_en: string;
  city_bg?: string;
  city_en?: string;
  sections: ProblemSection[];
};

type ProblemSectionsFile = { neighborhoods: ProblemNeighborhood[] };

type PreferenceRow = {
  partyNum: number;
  pref: string;
  oblast: string;
  totalVotes: number;
  paperVotes?: number;
  machineVotes?: number;
  partyVotes?: number; // votes for the party in that oblast
  partyPrefs?: number; // total preferential votes cast for the party in that oblast
  allVotes?: number; // all valid votes in that oblast
  lyTotalVotes?: number;
};

type PreferencesStats = {
  totalVotes: number;
  paperVotes?: number;
  machineVotes?: number;
  history?: Record<string, { totalVotes: number }>;
  top?: PreferenceRow[];
};

type Candidate = {
  name: string;
  oblast: string;
  partyNum: number;
  pref: string;
};

type SuemgRow = {
  oblast?: string;
  obshtina?: string;
  ekatte?: string;
  section?: string;
  topPartyChange?: { partyNum: number; change: number };
  bottomPartyChange?: { partyNum: number; change: number };
};

type RecountRow = {
  oblast?: string;
  obshtina?: string;
  topPartyChange?: { partyNum: number; change: number };
  bottomPartyChange?: { partyNum: number; change: number };
};

type ConcentratedRow = {
  partyNum: number;
  pctPartyVote?: number;
};

type NationalSummary = {
  turnout?: { pct?: number; priorPct?: number; deltaPct?: number };
  anomalies?: Record<string, number>;
  parties?: { partyNum: number; nickName: string; totalVotes: number }[];
};

const readJson = <T>(p: string): T | undefined => {
  if (!fs.existsSync(p)) return undefined;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
};

const round = (n: number, d = 2) => {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
};

const findPriorElection = (
  electionName: string,
  index: ElectionInfo[],
): ElectionInfo | undefined => {
  const idx = index.findIndex((e) => e.name === electionName);
  return idx >= 0 && idx < index.length - 1 ? index[idx + 1] : undefined;
};

const matchPrior = (
  party: { nickName: string; commonName?: string[] },
  votes: {
    number: number;
    nickName: string;
    commonName?: string[];
    totalVotes: number;
  }[],
) => {
  const matched = votes.filter((v) => {
    if (v.nickName === party.nickName) return true;
    if (
      v.commonName?.length &&
      party.nickName &&
      v.commonName.includes(party.nickName)
    )
      return true;
    if (
      party.commonName?.length &&
      v.commonName?.length &&
      party.commonName.some((c) => v.commonName!.includes(c))
    )
      return true;
    return false;
  });
  if (!matched.length) return undefined;
  return matched.reduce((s, v) => s + v.totalVotes, 0);
};

// Given a current party, find the set of partyNums in a prior election's
// cik_parties.json that should be treated as the same political force.
const matchPriorPartyNums = (
  current: { nickName: string; commonName?: string[] },
  priorParties: PartyInfo[],
): number[] => {
  const out: number[] = [];
  for (const p of priorParties) {
    if (p.nickName === current.nickName) {
      out.push(p.number);
      continue;
    }
    if (p.commonName?.length && p.commonName.includes(current.nickName)) {
      out.push(p.number);
      continue;
    }
    if (
      current.commonName?.length &&
      p.commonName?.length &&
      current.commonName.some((c) => p.commonName!.includes(c))
    ) {
      out.push(p.number);
    }
  }
  return out;
};

const positionOf = (
  partyNum: number,
  votes: { partyNum: number; totalVotes: number }[],
) => {
  const sorted = [...votes].sort((a, b) => b.totalVotes - a.totalVotes);
  const idx = sorted.findIndex((v) => v.partyNum === partyNum);
  return idx >= 0 ? idx + 1 : undefined;
};

// ---------- Geographic slice helpers ----------

type RegionRow = {
  oblast: string;
  name_bg?: string;
  name_en?: string;
  votes: number;
  pctOfRegion: number;
  priorVotes?: number;
  priorPctOfRegion?: number;
  deltaPctPoints?: number;
  pctOfPartyTotal: number;
};

const aggregateRegionGroup = (
  regions: RegionRow[],
  oblastSet: string[],
  partyNationalPct: number,
) => {
  const subset = regions.filter((r) => oblastSet.includes(r.oblast));
  if (!subset.length) return null;
  const votes = subset.reduce((s, r) => s + r.votes, 0);
  const allVotesInGroup = subset.reduce(
    (s, r) => s + (r.pctOfRegion ? (100 * r.votes) / r.pctOfRegion : 0),
    0,
  );
  const share = allVotesInGroup ? round((100 * votes) / allVotesInGroup) : 0;
  const priorVotes = subset.every((r) => r.priorVotes !== undefined)
    ? subset.reduce((s, r) => s + (r.priorVotes ?? 0), 0)
    : undefined;
  const priorAllVotes = subset.every(
    (r) => r.priorPctOfRegion !== undefined && r.priorVotes !== undefined,
  )
    ? subset.reduce(
        (s, r) =>
          s +
          (r.priorPctOfRegion! ? (100 * r.priorVotes!) / r.priorPctOfRegion! : 0),
        0,
      )
    : undefined;
  const priorShare =
    priorVotes !== undefined && priorAllVotes
      ? round((100 * priorVotes) / priorAllVotes)
      : undefined;
  const pctOfPartyTotal = round(
    subset.reduce((s, r) => s + r.pctOfPartyTotal, 0),
  );
  return {
    oblasts: subset.map((r) => r.oblast),
    votes,
    sharePct: share,
    priorVotes,
    priorSharePct: priorShare,
    deltaSharePP:
      priorShare !== undefined ? round(share - priorShare) : undefined,
    pctOfPartyTotal,
    overIndex: partyNationalPct ? round(share / partyNationalPct) : undefined,
  };
};

// ---------- Risk-neighborhood (problem-section) attribution ----------

const sumPartyVotesInProblemSections = (
  file: ProblemSectionsFile | undefined,
  partyNums: number[],
) => {
  if (!file?.neighborhoods?.length || !partyNums.length) return undefined;
  const partySet = new Set(partyNums);
  let totalAll = 0;
  let totalParty = 0;
  let sectionCount = 0;
  for (const n of file.neighborhoods) {
    for (const s of n.sections) {
      sectionCount += 1;
      for (const v of s.results?.votes ?? []) {
        totalAll += v.totalVotes ?? 0;
        if (partySet.has(v.partyNum)) totalParty += v.totalVotes ?? 0;
      }
    }
  }
  return { totalAll, totalParty, sectionCount };
};

const perNeighborhoodPartyVotes = (
  file: ProblemSectionsFile | undefined,
  partyNums: number[],
) => {
  if (!file?.neighborhoods?.length || !partyNums.length) return [];
  const partySet = new Set(partyNums);
  return file.neighborhoods.map((n) => {
    let partyVotes = 0;
    let total = 0;
    for (const s of n.sections) {
      for (const v of s.results?.votes ?? []) {
        total += v.totalVotes ?? 0;
        if (partySet.has(v.partyNum)) partyVotes += v.totalVotes ?? 0;
      }
    }
    return {
      id: n.id,
      name_bg: n.name_bg,
      name_en: n.name_en,
      city_bg: n.city_bg,
      city_en: n.city_en,
      sectionCount: n.sections.length,
      partyVotes,
      totalVotes: total,
      partyShareInNeighborhood: total ? round((100 * partyVotes) / total) : 0,
    };
  });
};

// ---------- Section-level anomaly attribution ----------

const countAnomalyAttribution = (
  rows: { topPartyChange?: { partyNum: number }; bottomPartyChange?: { partyNum: number } }[] | undefined,
  partyNum: number,
) => {
  if (!rows?.length) return { topChange: 0, bottomChange: 0 };
  let top = 0;
  let bottom = 0;
  for (const r of rows) {
    if (r.topPartyChange?.partyNum === partyNum) top += 1;
    if (r.bottomPartyChange?.partyNum === partyNum) bottom += 1;
  }
  return { topChange: top, bottomChange: bottom };
};

// ---------- Preferences (candidate-level) ----------

type PrefBlock = {
  totalPrefVotes: number;
  prefRate: number;
  topCandidatesNational: {
    pref: string;
    name?: string;
    oblast: string;
    oblastName_bg?: string;
    totalVotes: number;
    pctOfPartyPrefsNational: number;
  }[];
  topCandidatesByRegion: {
    oblast: string;
    name_bg?: string;
    name_en?: string;
    pref: string;
    candidateName?: string;
    votes: number;
    leaderVotes: number; // votes for the pref=101 candidate in that region
    leaderName?: string;
    pctOfRegionPartyPrefs: number;
    beatBallotOrder: boolean;
  }[];
  ballotOrderUpsets: number;
  ballotOrderUpsetRegions: { oblast: string; name_bg?: string }[];
  top1ShareOfPartyPrefs: number; // concentration: top candidate's share of all party prefs nationally
};

const buildPreferences = (
  election: string,
  partyNum: number,
  partyVotesNational: number,
  regions: Region[] | undefined,
  candidates: Candidate[] | undefined,
): PrefBlock | null => {
  const stats = readJson<PreferencesStats>(
    path.join(
      PUBLIC_DIR,
      election,
      "parties",
      "preferences",
      String(partyNum),
      "stats.json",
    ),
  );
  const regionsRows = readJson<PreferenceRow[]>(
    path.join(
      PUBLIC_DIR,
      election,
      "parties",
      "preferences",
      String(partyNum),
      "regions.json",
    ),
  );
  if (!stats || !regionsRows?.length) return null;

  const candidateLookup = new Map<string, string>();
  for (const c of candidates ?? []) {
    if (c.partyNum === partyNum) {
      candidateLookup.set(`${c.oblast}|${c.pref}`, c.name);
    }
  }

  const regionName = (oblast: string) =>
    regions?.find((r) => r.oblast === oblast);

  const totalPrefVotes = stats.totalVotes ?? 0;

  const topCandidatesNational = (stats.top ?? []).slice(0, 10).map((t) => ({
    pref: t.pref,
    name: candidateLookup.get(`${t.oblast}|${t.pref}`),
    oblast: t.oblast,
    oblastName_bg: regionName(t.oblast)?.name,
    totalVotes: t.totalVotes,
    pctOfPartyPrefsNational: totalPrefVotes
      ? round((100 * t.totalVotes) / totalPrefVotes)
      : 0,
  }));

  // Group by oblast for per-region winner detection
  const byOblast = new Map<string, PreferenceRow[]>();
  for (const r of regionsRows) {
    if (!byOblast.has(r.oblast)) byOblast.set(r.oblast, []);
    byOblast.get(r.oblast)!.push(r);
  }

  const topCandidatesByRegion: PrefBlock["topCandidatesByRegion"] = [];
  const upsetRegions: { oblast: string; name_bg?: string }[] = [];

  for (const [oblast, rows] of byOblast.entries()) {
    if (!rows.length) continue;
    const partyPrefsInRegion = rows[0].partyPrefs ?? 0;
    const leader = rows.find((r) => r.pref === "101");
    const winner = rows.reduce((m, r) =>
      r.totalVotes > m.totalVotes ? r : m,
    );
    const beatBallotOrder = !!leader && winner.pref !== leader.pref;
    if (beatBallotOrder) {
      upsetRegions.push({ oblast, name_bg: regionName(oblast)?.name });
    }
    const info = regionName(oblast);
    topCandidatesByRegion.push({
      oblast,
      name_bg: info?.name,
      name_en: info?.name_en,
      pref: winner.pref,
      candidateName: candidateLookup.get(`${oblast}|${winner.pref}`),
      votes: winner.totalVotes,
      leaderVotes: leader?.totalVotes ?? 0,
      leaderName: leader
        ? candidateLookup.get(`${oblast}|${leader.pref}`)
        : undefined,
      pctOfRegionPartyPrefs: partyPrefsInRegion
        ? round((100 * winner.totalVotes) / partyPrefsInRegion)
        : 0,
      beatBallotOrder,
    });
  }
  topCandidatesByRegion.sort((a, b) => b.votes - a.votes);

  const top1Votes = stats.top?.[0]?.totalVotes ?? 0;
  return {
    totalPrefVotes,
    prefRate: partyVotesNational
      ? round((100 * totalPrefVotes) / partyVotesNational)
      : 0,
    topCandidatesNational,
    topCandidatesByRegion,
    ballotOrderUpsets: upsetRegions.length,
    ballotOrderUpsetRegions: upsetRegions,
    top1ShareOfPartyPrefs: totalPrefVotes
      ? round((100 * top1Votes) / totalPrefVotes)
      : 0,
  };
};

// ---------- Head-to-head with closest national rival ----------

const buildCompetitive = (
  election: string,
  partyNum: number,
  enrichedRegions: RegionRow[],
  national: NationalSummary | undefined,
) => {
  if (!national?.parties?.length) return null;
  const self = national.parties.find((p) => p.partyNum === partyNum);
  if (!self) return null;
  const others = national.parties.filter(
    (p) => p.partyNum !== partyNum && (p.totalVotes ?? 0) > 0,
  );
  if (!others.length) return null;
  const rival = others.reduce((best, p) =>
    Math.abs(p.totalVotes - self.totalVotes) <
    Math.abs(best.totalVotes - self.totalVotes)
      ? p
      : best,
  );
  // Load rival's by_region file
  const rivalByRegion = readJson<PartyResultsRow[]>(
    path.join(
      PUBLIC_DIR,
      election,
      "parties",
      "by_region",
      `${rival.partyNum}.json`,
    ),
  );
  if (!rivalByRegion?.length) return null;
  const rivalMap = new Map<string, number>();
  for (const r of rivalByRegion) {
    if (r.oblast) rivalMap.set(r.oblast, r.totalVotes);
  }
  const rows = enrichedRegions
    .filter((r) => rivalMap.has(r.oblast))
    .map((r) => {
      const rivalVotes = rivalMap.get(r.oblast) ?? 0;
      const allVotes = r.pctOfRegion ? (100 * r.votes) / r.pctOfRegion : 0;
      const leadVotes = r.votes - rivalVotes;
      const leadPP = allVotes
        ? round((100 * leadVotes) / allVotes)
        : 0;
      return {
        oblast: r.oblast,
        name_bg: r.name_bg,
        name_en: r.name_en,
        partyVotes: r.votes,
        rivalVotes,
        leadVotes,
        leadPP,
      };
    })
    .sort((a, b) => b.leadPP - a.leadPP);
  const regionsWon = rows.filter((r) => r.leadVotes > 0).length;
  const regionsLost = rows.filter((r) => r.leadVotes < 0).length;
  return {
    rivalPartyNum: rival.partyNum,
    rivalNickName: rival.nickName,
    regionsWon,
    regionsLost,
    topMargins: rows.slice(0, 5),
    bottomMargins: rows.slice(-5).reverse(),
  };
};

const buildBundle = (election: string, partyNum: number) => {
  const electionsIndex = readJson<ElectionInfo[]>(ELECTIONS_INDEX);
  if (!electionsIndex) throw new Error(`missing ${ELECTIONS_INDEX}`);
  const electionInfo = electionsIndex.find((e) => e.name === election);
  if (!electionInfo) throw new Error(`unknown election: ${election}`);
  const prior = findPriorElection(election, electionsIndex);

  const partyInfos = readJson<PartyInfo[]>(
    path.join(PUBLIC_DIR, election, "cik_parties.json"),
  );
  if (!partyInfos) throw new Error(`missing cik_parties.json for ${election}`);
  const party = partyInfos.find((p) => p.number === partyNum);
  if (!party) throw new Error(`party ${partyNum} not found in ${election}`);

  const regions = readJson<Region[]>(
    path.resolve(__dirname, "../../src/data/json/regions.json"),
  );

  const totalVotes =
    electionInfo.results?.votes.reduce((s, v) => s + v.totalVotes, 0) ?? 0;
  const partyVotesEntry = electionInfo.results?.votes.find(
    (v) => v.number === partyNum,
  );
  const partyTotal = partyVotesEntry?.totalVotes ?? 0;
  const partyPct = totalVotes ? (100 * partyTotal) / totalVotes : 0;
  const pos = positionOf(
    partyNum,
    electionInfo.results?.votes.map((v) => ({
      partyNum: v.number,
      totalVotes: v.totalVotes,
    })) ?? [],
  );

  let priorTotal: number | undefined;
  let priorPartyTotal: number | undefined;
  let priorPos: number | undefined;
  if (prior?.results) {
    priorTotal = prior.results.votes.reduce((s, v) => s + v.totalVotes, 0);
    priorPartyTotal = matchPrior(
      { nickName: party.nickName, commonName: party.commonName },
      prior.results.votes,
    );
    if (priorPartyTotal) {
      const matchedNum = prior.results.votes.find(
        (v) => v.nickName === party.nickName,
      )?.number;
      if (matchedNum !== undefined) {
        priorPos = positionOf(
          matchedNum,
          prior.results.votes.map((v) => ({
            partyNum: v.number,
            totalVotes: v.totalVotes,
          })),
        );
      }
    }
  }

  // Per-region for this party (pre-aggregated file)
  const byRegion = readJson<PartyResultsRow[]>(
    path.join(PUBLIC_DIR, election, "parties", "by_region", `${partyNum}.json`),
  );
  const enrichedRegions: RegionRow[] = (byRegion ?? [])
    .map((r) => {
      const info = regions?.find((x) => x.oblast === r.oblast);
      const prior = r.prevYearVotesConsolidated ?? r.prevYearVotes;
      const priorPctOfRegion =
        prior !== undefined && r.allVotes
          ? round((100 * prior) / r.allVotes)
          : undefined;
      const currentPct = r.allVotes
        ? round((100 * r.totalVotes) / r.allVotes)
        : 0;
      return {
        oblast: r.oblast ?? "",
        name_en: info?.name_en,
        name_bg: info?.name,
        position: r.position,
        votes: r.totalVotes,
        priorVotes: prior,
        deltaVotes: prior !== undefined ? r.totalVotes - prior : undefined,
        pctOfRegion: currentPct,
        priorPctOfRegion,
        deltaPctPoints:
          priorPctOfRegion !== undefined
            ? round(currentPct - priorPctOfRegion)
            : undefined,
        pctOfPartyTotal: partyTotal
          ? round((100 * r.totalVotes) / partyTotal)
          : 0,
        machinePct: r.totalVotes
          ? round((100 * (r.machineVotes ?? 0)) / r.totalVotes)
          : 0,
      };
    })
    .sort((a, b) => b.votes - a.votes);

  // Per-municipality and per-settlement (top 25 each is enough for an LLM)
  const byMunicipality = readJson<PartyResultsRow[]>(
    path.join(
      PUBLIC_DIR,
      election,
      "parties",
      "by_municipality",
      `${partyNum}.json`,
    ),
  );
  const topMunicipalities = (byMunicipality ?? [])
    .slice()
    .sort((a, b) => b.totalVotes - a.totalVotes)
    .slice(0, 25)
    .map((r) => {
      const prior = r.prevYearVotesConsolidated ?? r.prevYearVotes;
      return {
        oblast: r.oblast,
        obshtina: r.obshtina,
        position: r.position,
        votes: r.totalVotes,
        deltaVotes: prior !== undefined ? r.totalVotes - prior : undefined,
        pctOfMuni: r.allVotes ? round((100 * r.totalVotes) / r.allVotes) : 0,
      };
    });

  const bySettlement = readJson<PartyResultsRow[]>(
    path.join(
      PUBLIC_DIR,
      election,
      "parties",
      "by_settlement",
      `${partyNum}.json`,
    ),
  );
  const topSettlements = (bySettlement ?? [])
    .slice()
    .sort((a, b) => b.totalVotes - a.totalVotes)
    .slice(0, 25)
    .map((r) => {
      const prior = r.prevYearVotesConsolidated ?? r.prevYearVotes;
      return {
        oblast: r.oblast,
        obshtina: r.obshtina,
        ekatte: r.ekatte,
        position: r.position,
        votes: r.totalVotes,
        deltaVotes: prior !== undefined ? r.totalVotes - prior : undefined,
        pctOfSettlement: r.allVotes
          ? round((100 * r.totalVotes) / r.allVotes)
          : 0,
      };
    });

  // Top regional gainers/losers
  const swings = enrichedRegions
    .filter((r) => r.deltaPctPoints !== undefined)
    .slice()
    .sort((a, b) => (b.deltaPctPoints ?? 0) - (a.deltaPctPoints ?? 0));
  const topGainers = swings.slice(0, 5);
  const topLosers = swings.slice(-5).reverse();

  // Optional: financing (only if hasFinancials)
  let financing: unknown = undefined;
  if (electionInfo.hasFinancials) {
    financing = readJson(
      path.join(
        PUBLIC_DIR,
        election,
        "parties",
        "financing",
        String(partyNum),
        "filing.json",
      ),
    );
  }

  // Optional: polling accuracy for THIS party (uses nickName as key).
  // CRITICAL: agencyHistoricalBias is recomputed from elections ≤ current so a
  // retrospect for an older election doesn't leak future-cycle data into the
  // "agency historical bias" that the LLM is given. The pre-aggregated
  // agencyProfiles in accuracy.json is built across ALL elections globally and
  // would leak future cycles into older retrospects.
  type Accuracy = {
    elections: {
      electionDate: string;
      agencies: {
        agencyId: string;
        daysBefore: number;
        respondents: number | null;
        errors: {
          key: string;
          polled: number;
          actual: number;
          error: number;
        }[];
      }[];
    }[];
  };
  const accuracy = readJson<Accuracy>(
    path.join(PUBLIC_DIR, "polls", "accuracy.json"),
  );
  const electionIso = election.replace(/_/g, "-");
  let pollingForParty:
    | {
        agencyId: string;
        daysBefore: number;
        respondents: number | null;
        polled: number;
        actual: number;
        error: number;
      }[]
    | undefined;
  let agencyHistoricalBias:
    | { agencyId: string; meanError: number; samples: number }[]
    | undefined;
  if (accuracy) {
    const eRow = accuracy.elections.find((e) => e.electionDate === electionIso);
    if (eRow) {
      pollingForParty = eRow.agencies
        .map((a) => {
          const e = a.errors.find((x) => x.key === party.nickName);
          if (!e) return undefined;
          return {
            agencyId: a.agencyId,
            daysBefore: a.daysBefore,
            respondents: a.respondents,
            polled: e.polled,
            actual: e.actual,
            error: e.error,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== undefined);
    }
    // Recompute bias per agency for this party using only elections ≤ current
    const priorAndCurrent = accuracy.elections.filter(
      (e) => e.electionDate <= electionIso,
    );
    const biasByAgency = new Map<string, { sum: number; n: number }>();
    for (const e of priorAndCurrent) {
      for (const a of e.agencies) {
        const err = a.errors.find((x) => x.key === party.nickName);
        if (!err) continue;
        const cur = biasByAgency.get(a.agencyId) ?? { sum: 0, n: 0 };
        cur.sum += err.error;
        cur.n += 1;
        biasByAgency.set(a.agencyId, cur);
      }
    }
    agencyHistoricalBias = [...biasByAgency.entries()]
      .map(([agencyId, { sum, n }]) => ({
        agencyId,
        meanError: round(sum / n),
        samples: n,
      }))
      .sort((a, b) => Math.abs(a.meanError) - Math.abs(b.meanError));
  }

  // ---------- Geographic structure ----------

  const top5RegionsShare = enrichedRegions
    .slice(0, 5)
    .reduce((s, r) => s + r.pctOfPartyTotal, 0);
  const top10MuniShare = topMunicipalities
    .slice(0, 10)
    .reduce(
      (s, r) => s + (partyTotal ? (100 * r.votes) / partyTotal : 0),
      0,
    );
  const top25MuniShare = topMunicipalities.reduce(
    (s, r) => s + (partyTotal ? (100 * r.votes) / partyTotal : 0),
    0,
  );

  const geography = {
    strongholds: {
      top5RegionsShareOfPartyTotal: round(top5RegionsShare),
      top10MunicipalitiesShareOfPartyTotal: round(top10MuniShare),
      top25MunicipalitiesShareOfPartyTotal: round(top25MuniShare),
    },
    urbanRural: {
      sofiaCity: aggregateRegionGroup(
        enrichedRegions,
        SOFIA_CITY_OBLASTS,
        partyPct,
      ),
      otherBigCities: aggregateRegionGroup(
        enrichedRegions,
        OTHER_BIG_CITY_OBLASTS,
        partyPct,
      ),
      abroad: aggregateRegionGroup(enrichedRegions, [ABROAD_OBLAST], partyPct),
    },
    ethnicMixedCluster: {
      oblasts: ETHNIC_MIXED_OBLASTS,
      ...aggregateRegionGroup(enrichedRegions, ETHNIC_MIXED_OBLASTS, partyPct),
    },
  };

  // ---------- Risk-neighborhood (problem-section) attribution ----------

  const problemFile = readJson<ProblemSectionsFile>(
    path.join(PUBLIC_DIR, election, "problem_sections.json"),
  );
  let problemBlock: object | null = null;
  if (problemFile?.neighborhoods?.length) {
    const current = sumPartyVotesInProblemSections(problemFile, [partyNum]);
    let priorShare: number | undefined;
    let priorPartyVotes: number | undefined;
    if (prior?.name) {
      const priorProblemFile = readJson<ProblemSectionsFile>(
        path.join(PUBLIC_DIR, prior.name, "problem_sections.json"),
      );
      const priorPartyInfos = readJson<PartyInfo[]>(
        path.join(PUBLIC_DIR, prior.name, "cik_parties.json"),
      );
      if (priorProblemFile && priorPartyInfos) {
        const priorNums = matchPriorPartyNums(
          { nickName: party.nickName, commonName: party.commonName },
          priorPartyInfos,
        );
        const priorAgg = sumPartyVotesInProblemSections(
          priorProblemFile,
          priorNums,
        );
        if (priorAgg && priorAgg.totalAll) {
          priorPartyVotes = priorAgg.totalParty;
          priorShare = round((100 * priorAgg.totalParty) / priorAgg.totalAll);
        }
      }
    }
    const currentShare =
      current && current.totalAll
        ? round((100 * current.totalParty) / current.totalAll)
        : 0;
    problemBlock = {
      totalRiskSections: current?.sectionCount ?? 0,
      totalRiskVotes: current?.totalAll ?? 0,
      partyVotesInRiskSections: current?.totalParty ?? 0,
      partyShareOfRiskVotes: currentShare,
      overIndex: partyPct ? round(currentShare / partyPct) : undefined,
      priorPartyVotesInRiskSections: priorPartyVotes,
      priorPartyShareOfRiskVotes: priorShare,
      deltaShareOfRiskPP:
        priorShare !== undefined ? round(currentShare - priorShare) : undefined,
      topNeighborhoods: perNeighborhoodPartyVotes(problemFile, [partyNum])
        .sort((a, b) => b.partyVotes - a.partyVotes)
        .slice(0, 5),
    };
  }

  // ---------- Section-level anomaly attribution ----------

  const suemg = readJson<SuemgRow[]>(
    path.join(PUBLIC_DIR, election, "reports", "section", "suemg.json"),
  );
  const recount = readJson<RecountRow[]>(
    path.join(PUBLIC_DIR, election, "reports", "section", "recount.json"),
  );
  const concentrated = readJson<ConcentratedRow[]>(
    path.join(PUBLIC_DIR, election, "reports", "section", "concentrated.json"),
  );
  const suemgAttr = countAnomalyAttribution(suemg, partyNum);
  const recountAttr = countAnomalyAttribution(recount, partyNum);
  const concentratedCount = (concentrated ?? []).filter(
    (c) => c.partyNum === partyNum,
  ).length;
  const sectionAnomalies = {
    suemgFlaggedSectionsTotal: suemg?.length ?? 0,
    suemgTopChangeForParty: suemgAttr.topChange,
    suemgBottomChangeForParty: suemgAttr.bottomChange,
    recountFlaggedSectionsTotal: recount?.length ?? 0,
    recountTopChangeForParty: recountAttr.topChange,
    recountBottomChangeForParty: recountAttr.bottomChange,
    concentratedSectionsForParty: concentratedCount,
  };

  // ---------- Preferences (candidate-level) ----------

  const candidates = electionInfo.hasPreferences
    ? readJson<Candidate[]>(path.join(PUBLIC_DIR, election, "candidates.json"))
    : undefined;
  const preferences = electionInfo.hasPreferences
    ? buildPreferences(election, partyNum, partyTotal, regions, candidates)
    : null;

  // ---------- Head-to-head with closest national rival ----------

  const national = readJson<NationalSummary>(
    path.join(PUBLIC_DIR, election, "national_summary.json"),
  );
  const competitive = buildCompetitive(
    election,
    partyNum,
    enrichedRegions,
    national,
  );

  // ---------- National context snapshot ----------

  const contextSnapshot = {
    nationalTurnoutPct: national?.turnout?.pct,
    priorTurnoutPct: national?.turnout?.priorPct,
    deltaTurnoutPP: national?.turnout?.deltaPct,
    anomalies: national?.anomalies,
  };

  return {
    schemaVersion: 2,
    election,
    priorElection: prior?.name,
    party: {
      number: party.number,
      nickName: party.nickName,
      name_bg: party.name,
      name_en: party.name_en,
      color: party.color,
    },
    nationalContext: {
      totalNationalVotes: totalVotes,
      partyVotes: partyTotal,
      partyPct: round(partyPct),
      position: pos,
      passedThreshold: partyPct >= 4,
      priorTotalNationalVotes: priorTotal,
      priorPartyVotes: priorPartyTotal,
      priorPartyPct:
        priorTotal && priorPartyTotal !== undefined
          ? round((100 * priorPartyTotal) / priorTotal)
          : undefined,
      priorPosition: priorPos,
      deltaVotes:
        priorPartyTotal !== undefined
          ? partyTotal - priorPartyTotal
          : undefined,
      deltaPctPoints:
        priorTotal && priorPartyTotal !== undefined && totalVotes
          ? round(
              (100 * partyTotal) / totalVotes -
                (100 * priorPartyTotal) / priorTotal,
            )
          : undefined,
    },
    paperMachine: partyVotesEntry
      ? {
          paper: partyVotesEntry.paperVotes ?? 0,
          machine: partyVotesEntry.machineVotes ?? 0,
          paperPct:
            (partyVotesEntry.paperVotes ?? 0) +
              (partyVotesEntry.machineVotes ?? 0) >
            0
              ? round(
                  (100 * (partyVotesEntry.paperVotes ?? 0)) /
                    ((partyVotesEntry.paperVotes ?? 0) +
                      (partyVotesEntry.machineVotes ?? 0)),
                )
              : 0,
        }
      : undefined,
    contextSnapshot,
    regions: enrichedRegions,
    topGainerRegions: topGainers,
    topLoserRegions: topLosers,
    topMunicipalities,
    topSettlements,
    geography,
    problemSections: problemBlock,
    sectionAnomalies,
    competitive,
    preferences,
    financing: financing ?? null,
    polling: pollingForParty
      ? {
          finalPollErrors: pollingForParty,
          agencyHistoricalBias,
        }
      : null,
  };
};

const app = command({
  name: "bundle_party_data",
  args: {
    election: option({
      type: string,
      long: "election",
      short: "e",
      description: "Election folder name, e.g. 2024_10_27",
    }),
    party: option({
      type: string,
      long: "party",
      short: "p",
      description: "Party number (matches cik_parties.json)",
    }),
    out: option({
      type: optional(string),
      long: "out",
      short: "o",
      description: "Optional output file (default: stdout)",
    }),
  },
  handler: ({ election, party, out }) => {
    const partyNum = parseInt(party, 10);
    if (!Number.isFinite(partyNum)) throw new Error(`invalid party: ${party}`);
    const bundle = buildBundle(election, partyNum);
    const json = JSON.stringify(bundle, null, 2);
    if (out) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, json);
      console.error(`✓ wrote ${out} (${json.length} bytes)`);
    } else {
      process.stdout.write(json);
    }
  },
});

run(app, process.argv.slice(2));
