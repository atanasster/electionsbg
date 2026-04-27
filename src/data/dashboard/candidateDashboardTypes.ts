import { CandidateStatsYearly, PreferencesInfo } from "../dataTypes";
import { PaperMachineSummary } from "./dashboardTypes";

export type CandidateRegionRow = {
  oblast: string;
  name?: string;
  name_en?: string;
  long_name?: string;
  long_name_en?: string;
  pref: string;
  totalVotes: number;
  paperVotes?: number;
  machineVotes?: number;
  partyVotes?: number;
  partyPrefs?: number;
  allVotes?: number;
  pctOfPartyPrefs?: number;
  pctOfPartyVotes?: number;
  pctOfRegion?: number;
  priorTotalVotes?: number;
  deltaVotes?: number;
};

export type CandidateDashboardSummary = {
  election: string;
  priorElection?: string;
  name: string;
  partyNum: number;
  partyNickName?: string;
  partyName?: string;
  partyColor?: string;

  totalVotes: number;
  priorTotalVotes?: number;
  deltaVotes?: number;
  deltaPct?: number;

  pctOfPartyPrefs?: number;
  partyPrefs?: number;

  paperMachine?: PaperMachineSummary;

  regions: CandidateRegionRow[];

  topSettlements: PreferencesInfo[];
  topSections: PreferencesInfo[];
  history: CandidateStatsYearly[];
};
