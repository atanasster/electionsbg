// Front-end mirror of scripts/parsers_local/types.ts.
//
// Kept duplicated rather than imported so the SPA bundle doesn't pull in
// Node-only types. The parser is the source of truth — these must stay in
// sync. When the parser shape changes, update this file too.

export type LocalRound = 1 | 2;

export type LocalMayorResult = {
  candidateName: string;
  localPartyNum: number;
  localPartyName: string;
  primaryCanonicalId: string | null;
  memberCanonicalIds: string[];
  isIndependent: boolean;
  round: LocalRound;
  votes: number;
  pctOfValid: number;
  isElected: boolean;
  // Stamped post-ingest by scripts/parsers_local/decorate_local_mp_links.ts
  // when this candidate also served as an MP. Consumed by `MpAvatar` to
  // reuse the parliament.bg portrait.
  mpId?: number;
};

export type LocalCouncilCandidate = {
  listPos: number;
  name: string;
  prefVotes: number;
  prefPct: number;
  isElected: boolean;
  mpId?: number;
};

export type LocalCouncilParty = {
  localPartyNum: number;
  localPartyName: string;
  primaryCanonicalId: string | null;
  memberCanonicalIds: string[];
  isIndependent: boolean;
  totalVotes: number;
  pctOfValid: number;
  mandatesWon: number;
  candidates: LocalCouncilCandidate[];
};

export type LocalKmetstvoResult = {
  kmetstvoName: string;
  ekatte: string;
  candidates: LocalMayorResult[];
};

export type LocalDistrictMayorResult = {
  districtName: string;
  districtCode: string;
  candidates: LocalMayorResult[]; // round 1
  // Round-2 (балотаж) table — present only when the район went to a runoff.
  round2?: LocalMayorResult[];
  // Resolved winner: round-2 winner when there was a runoff, else the
  // round-1 outright winner. CIK marks both finalists elected in round 1,
  // so consumers must prefer this over `candidates.find(isElected)`.
  elected?: LocalMayorResult | null;
};

export type LocalMunicipalityBundle = {
  cycle: string;
  oikCode: string;
  obshtinaCode: string;
  obshtinaName: string;
  oblastName: string;
  protocol: {
    numRegisteredVoters: number;
    totalActualVoters: number;
    numValidVotes: number;
  };
  mayor: {
    round1: LocalMayorResult[];
    round2?: LocalMayorResult[];
    elected: LocalMayorResult | null;
  };
  council: LocalCouncilParty[];
  kmetstva: LocalKmetstvoResult[];
  districts: LocalDistrictMayorResult[];
};

export type LocalElectionIndex = {
  cycle: string;
  round1Date: string;
  round2Date: string | null;
  municipalities: {
    oikCode: string;
    obshtinaCode: string;
    name: string;
    oblast: string;
    hadRound2: boolean;
  }[];
  councilVoteShare: {
    canonicalId: string;
    displayName: string;
    color: string;
    totalVotes: number;
    pctOfValid: number;
  }[];
  mayorsByCanonical: {
    canonicalId: string;
    displayName: string;
    color: string;
    count: number;
  }[];
};

// === Officials-vs-CIK reconciliation =====================================

export type MayorDiffStatus =
  | "match"
  | "replaced"
  | "missing_official"
  | "missing_cik";

export type OfficialsDiffOverall =
  | "match"
  | "partial_mismatch"
  | "mismatch"
  | "missing";

export type MunicipalityOfficialsDiff = {
  obshtinaCode: string;
  obshtinaName: string;
  mayor: {
    cikName: string | null;
    cikParty: string | null;
    cikRound: 1 | 2 | null;
    officialName: string | null;
    officialSlug: string | null;
    officialYear: number | null;
    status: MayorDiffStatus;
    // When status is "replaced" and a later partial/new election installed
    // the sitting officer. matchesOfficial = that chmi winner is the current
    // roster mayor (the mismatch is fully explained).
    replacedBy?: {
      name: string;
      date: string;
      cycle: string;
      matchesOfficial: boolean;
    } | null;
  };
  council: {
    cikSeats: number;
    cikElectedCount: number;
    officialSeats: number;
    matched: number;
    onlyInCik: {
      name: string;
      party: string;
      primaryCanonicalId: string | null;
    }[];
    onlyInOfficial: { name: string; slug: string }[];
  };
  overallStatus: OfficialsDiffOverall;
};

export type CycleOfficialsDiff = {
  cycle: string;
  generatedAt: string;
  summary: {
    municipalitiesChecked: number;
    mayorMatches: number;
    mayorReplaced: number;
    mayorMissingOfficial: number;
    mayorMissingCik: number;
    totalCikElectedCouncillors: number;
    totalOfficialCouncillors: number;
    totalCouncillorMatches: number;
  };
  municipalities: MunicipalityOfficialsDiff[];
};

// === Region rollups ======================================================
// Mirror of scripts/parsers_local/build_region_json.ts. Per-oblast rollup
// (one fetch per region dashboard) + the national region-control summary
// that drives the mayors-control choropleth and the top-regions table.

export type LocalPartyTally = {
  canonicalId: string;
  displayName: string;
  color: string;
  count: number;
};

export type LocalPartySeats = {
  canonicalId: string;
  displayName: string;
  color: string;
  seats: number;
};

export type LocalTurnout = {
  numRegisteredVoters: number;
  totalActualVoters: number;
  numValidVotes: number;
  pct: number | null;
};

export type LocalRegionMunicipalityRow = {
  obshtinaCode: string;
  name: string;
  hadRound2: boolean;
  councilSeats: number;
  electedMayor: {
    candidateName: string;
    canonicalId: string;
    displayName: string;
    color: string;
    localPartyName: string;
  } | null;
  turnout: LocalTurnout;
};

export type LocalRegionRollup = {
  cycle: string;
  oblast: string;
  round1Date: string;
  round2Date: string | null;
  municipalityCount: number;
  runoffCount: number;
  turnout: LocalTurnout;
  mayorsWon: LocalPartyTally[];
  councilSeats: LocalPartySeats[];
  municipalities: LocalRegionMunicipalityRow[];
};

export type LocalRegionsSummaryRow = {
  oblast: string;
  municipalityCount: number;
  runoffCount: number;
  totalCouncilSeats: number;
  turnoutPct: number | null;
  topMayor: LocalPartyTally | null;
  topCouncil: LocalPartySeats | null;
};

export type LocalRegionsSummary = {
  cycle: string;
  round1Date: string;
  round2Date: string | null;
  regions: LocalRegionsSummaryRow[];
};
