// Type definitions for the local-elections parser tree.
//
// Bulgarian local elections have four ballot types per municipality, each
// emitted by CIK as its own bundle of TXT files in csv.zip:
//
//   ОС  Общински Съветници   municipal council (proportional, with preferences)
//   КО  Кмет на Община       município mayor (FPTP, two rounds for large municípios)
//   КК  Кмет на Кметство     kmetstvo mayor (per village seat, often single round)
//   КР  Кмет на Район        district mayor (Sofia/Plovdiv/Varna only)
//
// The TXT files share the parliamentary protocol/votes/sections column layout
// (so we reuse those parsers via thin adapters), but the elected councillor
// list — the actual output of preference re-ranking and Hare-Niemeyer seat
// allocation — is NOT in the TXT bundle. We scrape that from the per-município
// HTML page at /mi{YYYY}/tur1/rezultati/{oikCode}.html, where the "Мандати"
// column marks each elected candidate with a literal "1".

export type LocalRaceType = "OS" | "KO" | "KK" | "KR";
export type LocalRound = 1 | 2;

// One row of cik_parties.txt — the national party register that defines
// the party-number → party-name mapping used across all municípios.
export type CikParty = {
  number: number;
  name: string;
};

// One row of local_parties.txt — a party/coalition/initiative committee
// registered at a specific OIK. The same numeric ID means different
// parties in different OIKs.
export type LocalParty = {
  oikCode: string; // 4-digit, e.g. "0103"
  oikName: string;
  localPartyNum: number;
  localPartyName: string;
  isIndependent: boolean; // true for "Инициативен комитет ..."
  // Resolved by local_coalitions.ts:
  primaryCanonicalId: string | null;
  memberCanonicalIds: string[];
  unmatchedFragments: string[];
};

// One row of local_candidates.txt — a single candidate on a party's list.
export type LocalCandidate = {
  oikCode: string;
  oikName: string;
  localPartyNum: number;
  localPartyName: string;
  listPos: number;
  candidateName: string;
};

// One row of sections.txt for a local election. Identical column layout to
// the parliamentary sections.txt; the value-add for locals is that the
// admin_unit_id field encodes the OIK code, giving us the section → OIK
// join we need for fan-out per município.
export type LocalSection = {
  sectionCode: string; // 9 digits
  oikCode: string; // 4 digits, derived from admin_unit_id
  oblastName: string;
  ekatte: string;
  settlement: string;
  isMobile: boolean;
};

// One row of preferences.txt — applies to council ballots only.
export type LocalPreference = {
  sectionCode: string;
  localPartyNum: number;
  listPos: number; // 0 = "no preference indicated"
  count: number;
};

// Mayor result, scraped from the per-município HTML page. One per candidate
// per round.
//
// `mpId` is a post-ingest decoration stamped by
// scripts/parsers_local/decorate_local_mp_links.ts when the candidate's
// normalised name matches a parliament.bg MP. Drives photo reuse via
// `MpAvatar`; absent means no MP match.
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
  mpId?: number;
};

// Council result — one entry per party that ran in this município, scraped
// from the HTML. Includes the full candidate list with the "isElected"
// marker from the Мандати column.
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

export type LocalCouncilCandidate = {
  listPos: number;
  name: string;
  prefVotes: number;
  prefPct: number;
  isElected: boolean;
  // Stamped by decorate_local_mp_links.ts when this councillor also served
  // as an MP — drives photo reuse via `MpAvatar`.
  mpId?: number;
};

// Kmetstvo mayor result — one block per village seat. Often unanimous /
// uncontested; sometimes goes to a runoff like a município mayor.
export type LocalKmetstvoResult = {
  kmetstvoName: string;
  ekatte: string;
  candidates: LocalMayorResult[];
};

// District mayor result (Sofia/Plovdiv/Varna).
export type LocalDistrictMayorResult = {
  districtName: string;
  districtCode: string; // район code, e.g. "23-46-08"
  candidates: LocalMayorResult[];
};

// The full per-município bundle written to data/{cycle}/municipalities/{obshtinaCode}.json
export type LocalMunicipalityBundle = {
  cycle: string; // e.g. "2023_10_29_mi"
  oikCode: string;
  obshtinaCode: string;
  obshtinaName: string;
  oblastName: string;
  // Basic protocol totals from the council ballot (the most-cast vote, so
  // a sensible "turnout for this município" denominator).
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
  districts: LocalDistrictMayorResult[]; // empty for non-Sofia/Plovdiv/Varna
};

// The cycle-level catalogue written to data/{cycle}/index.json
export type LocalElectionIndex = {
  cycle: string;
  round1Date: string; // ISO date
  round2Date: string | null;
  municipalities: {
    oikCode: string;
    obshtinaCode: string;
    name: string;
    oblast: string;
    hadRound2: boolean;
  }[];
  // National rollups (council R1 votes only — per the design decision)
  councilVoteShare: {
    canonicalId: string;
    displayName: string;
    color: string;
    totalVotes: number;
    pctOfValid: number;
  }[];
  // How many município mayors each canonical party won (independents bucketed)
  mayorsByCanonical: {
    canonicalId: string; // "independent" for ИК
    displayName: string;
    color: string;
    count: number;
  }[];
};
