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
};

export type LocalCouncilCandidate = {
  listPos: number;
  name: string;
  prefVotes: number;
  prefPct: number;
  isElected: boolean;
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
  candidates: LocalMayorResult[];
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
