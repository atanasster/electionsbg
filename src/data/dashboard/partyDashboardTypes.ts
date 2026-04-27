import { PaperMachineSummary } from "./dashboardTypes";

export type PartyLocationRow = {
  key: string;
  name?: string;
  name_en?: string;
  long_name?: string;
  long_name_en?: string;
  parentKey?: string;
  oblast?: string;
  position: number;
  totalVotes: number;
  paperVotes?: number;
  machineVotes?: number;
  allVotes: number;
  pctOfLocation: number;
  pctOfPartyTotal: number;
  prevYearVotes?: number;
  deltaVotes?: number;
  deltaPctPoints?: number;
};

export type PartySwingRegion = {
  key: string;
  name?: string;
  oblast?: string;
  position: number;
  currentPct: number;
  priorPct?: number;
  deltaPctPoints?: number;
  totalVotes: number;
  prevYearVotes?: number;
};

export type PartyDashboardSummary = {
  election: string;
  priorElection?: string;
  partyNum: number;
  nickName: string;
  name?: string;
  name_en?: string;
  color?: string;

  totalVotes: number;
  pctNational: number;
  position: number;
  passedThreshold: boolean;

  priorTotalVotes?: number;
  priorPctNational?: number;
  priorPosition?: number;
  deltaVotes?: number;
  deltaPctNational?: number;
  deltaPosition?: number;

  paperMachine?: PaperMachineSummary;

  topRegion?: PartyLocationRow;
  bottomRegion?: PartyLocationRow;
  biggestGainerRegion?: PartySwingRegion;
  biggestLoserRegion?: PartySwingRegion;

  regions: PartyLocationRow[];
  swings: PartySwingRegion[];
};
