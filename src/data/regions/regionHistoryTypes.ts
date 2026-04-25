export type RegionHistoryVote = {
  partyNum: number;
  nickName: string;
  color?: string;
  totalVotes: number;
  pct: number;
  commonName?: string[];
};

export type RegionHistoryEntry = {
  election: string;
  totalVotes: number;
  registeredVoters?: number;
  actualVoters?: number;
  turnoutPct?: number;
  votes: RegionHistoryVote[];
};

export type RegionHistory = {
  region: string;
  history: RegionHistoryEntry[];
};
