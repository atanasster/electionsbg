export type NationalPartyResult = {
  partyNum: number;
  nickName: string;
  name?: string;
  name_en?: string;
  color?: string;
  totalVotes: number;
  pct: number;
  priorPct?: number;
  deltaPct?: number;
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

export type PaperMachineSummary = {
  paperVotes: number;
  machineVotes: number;
  total: number;
  paperPct: number;
  machinePct: number;
  priorPaperPct?: number;
  priorMachinePct?: number;
  deltaPaperPct?: number;
  deltaMachinePct?: number;
};

export type TopLocation = {
  ekatte: string;
  name: string;
  name_en?: string;
  sections: number;
  voters?: number;
  // Optional override target — used to point Sofia (which is split across many
  // 68134-* subdivision EKATTEs and has no /sections/68134 page) to /sofia.
  urlPath?: string;
  // Winning party at this location (highest totalVotes).
  winnerPartyNum?: number;
  winnerNickName?: string;
  winnerColor?: string;
};

// National wasted-vote summary: share of valid votes cast for parties that
// fell below the 4% threshold and won zero seats. `almostMadeIt` is the 2–4%
// band (parties that came close); `fringe` is <2%.
export type WastedVotesSummary = {
  validVotes: number;
  wastedVotes: number;
  share: number;
  almostMadeItVotes: number;
  almostMadeItShare: number;
  fringeVotes: number;
  fringeShare: number;
  parties: { partyNum: number; totalVotes: number; pct: number }[];
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
  paperMachine?: PaperMachineSummary;
  parties: NationalPartyResult[];
  topDiaspora?: TopLocation[];
  topCities?: TopLocation[];
  wastedVotes?: WastedVotesSummary;
};
