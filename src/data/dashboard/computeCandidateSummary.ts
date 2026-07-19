// The pure reducer that turns a candidate's raw regions.json rows + preferences_stats into a
// CandidateDashboardSummary. Extracted from useCandidateSummary so it can run over EITHER the
// name-folder shards (useCandidateSummary) OR the person-keyed PG payload (usePersonElections,
// person-candidate-merge-v1) — one computation, no divergence.

import { CandidateStats, PreferencesInfo } from "../dataTypes";
import { PaperMachineSummary } from "./dashboardTypes";
import {
  CandidateDashboardSummary,
  CandidateRegionRow,
} from "./candidateDashboardTypes";

const round = (n: number, digits = 2): number => {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
};

type PartyLike = { nickName?: string; name?: string; color?: string } | null;
type RegionLike = {
  name?: string;
  name_en?: string;
  long_name?: string;
  long_name_en?: string;
} | null;

export type ComputeCandidateSummaryArgs = {
  name: string;
  selected: string;
  priorElectionName?: string;
  regionRows: PreferencesInfo[];
  stats: CandidateStats | null;
  findParty: (partyNum: number) => PartyLike;
  findRegion: (oblast: string) => RegionLike;
};

export const computeCandidateSummary = ({
  name,
  selected,
  priorElectionName,
  regionRows,
  stats,
  findParty,
  findRegion,
}: ComputeCandidateSummaryArgs): CandidateDashboardSummary => {
  const partyNum = regionRows[0]?.partyNum ?? 0;
  const party = findParty(partyNum);

  const totalVotes = regionRows.reduce((s, r) => s + r.totalVotes, 0);
  const priorTotalVotes = regionRows.some((r) => r.lyTotalVotes !== undefined)
    ? regionRows.reduce((s, r) => s + (r.lyTotalVotes ?? 0), 0)
    : undefined;
  const deltaVotes =
    priorTotalVotes !== undefined ? totalVotes - priorTotalVotes : undefined;
  const deltaPct =
    priorTotalVotes && priorTotalVotes > 0
      ? round(((totalVotes - priorTotalVotes) / priorTotalVotes) * 100)
      : undefined;

  const partyPrefs = regionRows.some((r) => r.partyPrefs !== undefined)
    ? regionRows.reduce((s, r) => s + (r.partyPrefs ?? 0), 0)
    : undefined;
  const pctOfPartyPrefs =
    partyPrefs && partyPrefs > 0
      ? round((100 * totalVotes) / partyPrefs)
      : undefined;

  const paper = regionRows.reduce((s, r) => s + (r.paperVotes ?? 0), 0);
  const machine = regionRows.reduce((s, r) => s + (r.machineVotes ?? 0), 0);
  const pmTotal = paper + machine;
  const lyPaper = regionRows.reduce((s, r) => s + (r.lyPaperVotes ?? 0), 0);
  const lyMachine = regionRows.reduce((s, r) => s + (r.lyMachineVotes ?? 0), 0);
  const lyPmTotal = lyPaper + lyMachine;
  const paperMachine: PaperMachineSummary | undefined = pmTotal
    ? {
        paperVotes: paper,
        machineVotes: machine,
        total: pmTotal,
        paperPct: round((100 * paper) / pmTotal),
        machinePct: round((100 * machine) / pmTotal),
        priorPaperPct: lyPmTotal
          ? round((100 * lyPaper) / lyPmTotal)
          : undefined,
        priorMachinePct: lyPmTotal
          ? round((100 * lyMachine) / lyPmTotal)
          : undefined,
        deltaPaperPct: lyPmTotal
          ? round((100 * paper) / pmTotal - (100 * lyPaper) / lyPmTotal)
          : undefined,
        deltaMachinePct: lyPmTotal
          ? round((100 * machine) / pmTotal - (100 * lyMachine) / lyPmTotal)
          : undefined,
      }
    : undefined;

  const regions: CandidateRegionRow[] = regionRows
    .map((r) => {
      const info = findRegion(r.oblast ?? "");
      return {
        oblast: r.oblast ?? "",
        name: info?.name,
        name_en: info?.name_en,
        long_name: info?.long_name,
        long_name_en: info?.long_name_en,
        pref: r.pref,
        totalVotes: r.totalVotes,
        paperVotes: r.paperVotes,
        machineVotes: r.machineVotes,
        partyVotes: r.partyVotes,
        partyPrefs: r.partyPrefs,
        allVotes: r.allVotes,
        pctOfPartyPrefs:
          r.partyPrefs && r.partyPrefs > 0
            ? round((100 * r.totalVotes) / r.partyPrefs)
            : undefined,
        pctOfPartyVotes:
          r.partyVotes && r.partyVotes > 0
            ? round((100 * r.totalVotes) / r.partyVotes)
            : undefined,
        pctOfRegion:
          r.allVotes && r.allVotes > 0
            ? round((100 * r.totalVotes) / r.allVotes)
            : undefined,
        priorTotalVotes: r.lyTotalVotes,
        deltaVotes:
          r.lyTotalVotes !== undefined
            ? r.totalVotes - r.lyTotalVotes
            : undefined,
      } as CandidateRegionRow;
    })
    .sort((a, b) => b.totalVotes - a.totalVotes);

  return {
    election: selected,
    priorElection: priorElectionName,
    name,
    partyNum,
    partyNickName: party?.nickName,
    partyName: party?.name,
    partyColor: party?.color,

    totalVotes,
    priorTotalVotes,
    deltaVotes,
    deltaPct,

    pctOfPartyPrefs,
    partyPrefs,

    paperMachine,

    regions,

    topSettlements: stats?.top_settlements ?? [],
    topSections: stats?.top_sections ?? [],
    history: stats?.stats ?? [],
  };
};
