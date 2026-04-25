export type NationalPartyResult = {
  partyNum: number;
  nickName: string;
  name?: string;
  name_en?: string;
  color?: string;
  totalVotes: number;
  pct: number;
  seats?: number;
  passedThreshold: boolean;
};

export type PartyChange = {
  partyNum: number;
  nickName: string;
  color?: string;
  currentVotes: number;
  currentPct: number;
  priorVotes: number;
  priorPct: number;
  deltaVotes: number;
  deltaPct: number;
};

export type AnomalyCounts = {
  total: number;
  recount: number;
  recountZeroVotes: number;
  suemgAdded: number;
  suemgRemoved: number;
  suemgMissingFlash: number;
  problemSections: number;
};

export type NationalSummary = {
  election: string;
  priorElection?: string;
  turnout: {
    actual: number;
    registered: number;
    pct: number;
    priorPct?: number;
    deltaPct?: number;
  };
  topGainer?: PartyChange;
  topLoser?: PartyChange;
  anomalies: AnomalyCounts;
  parties: NationalPartyResult[];
};
