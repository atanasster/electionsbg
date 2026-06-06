// Local-elections cycle registry + fetch helpers (mirrors dataset.ts but for the
// municipal cycles). The registry is bundled; per-cycle rollups and per-município
// bundles are fetched from the data bucket.

import localJson from "../../src/data/json/local_elections.json";
import { fetchData } from "./dataClient";

export type LocalCycle = {
  name: string; // e.g. "2023_10_29_mi"
  round1Date: string;
  round2Date: string | null;
  kind: "regular" | "partial";
};

export const LOCAL_CYCLES = (localJson as LocalCycle[]).filter(
  (c) => c.kind === "regular",
);

export const latestLocalCycle = (): string => LOCAL_CYCLES[0].name;

export const localCycleNames = (): string[] => LOCAL_CYCLES.map((c) => c.name);

export const isKnownLocalCycle = (name: string): boolean =>
  LOCAL_CYCLES.some((c) => c.name === name);

// Resolve a `cycle` arg to a known local cycle (YYYY_MM_DD_mi), falling back to
// the latest. Like resolveElection: an exact cycle name passes through; a bare
// year or loose date ("2019", "2019-10-27") maps to that year's regular cycle
// (local cycles are one-per-year), so "местни избори 2019" stops silently
// answering for the latest cycle. Only an unplaceable arg falls back to latest.
export const resolveLocalCycle = (raw?: string): string => {
  if (!raw) return latestLocalCycle();
  if (isKnownLocalCycle(raw)) return raw;
  const m = raw.match(/20\d{2}/);
  if (m) {
    const hit = LOCAL_CYCLES.find((c) => c.name.startsWith(`${m[0]}_`));
    if (hit) return hit.name;
  }
  return latestLocalCycle();
};

// "2023_10_29_mi" -> "2023"
export const localCycleYear = (name: string): string => name.slice(0, 4);

// ---- fetched shapes ---------------------------------------------------------

export type CanonShareRow = {
  canonicalId: string;
  displayName: string;
  color?: string;
  totalVotes: number;
  pctOfValid: number;
};
export type MayorsRow = {
  canonicalId: string;
  displayName: string;
  color?: string;
  count: number;
};
export type MuniListRow = {
  oikCode: string;
  obshtinaCode: string;
  name: string;
  oblast: string;
  hadRound2: boolean;
};
export type LocalIndex = {
  cycle: string;
  round1Date: string;
  round2Date: string | null;
  municipalities: MuniListRow[];
  councilVoteShare: CanonShareRow[];
  mayorsByCanonical: MayorsRow[];
};

export type LocalCandidate = {
  candidateName: string;
  localPartyName: string;
  primaryCanonicalId: string;
  isIndependent: boolean;
  votes?: number;
  pctOfValid?: number;
  isElected?: boolean;
  round?: number;
};
export type LocalCouncilParty = {
  localPartyName: string;
  primaryCanonicalId: string;
  isIndependent: boolean;
  totalVotes: number;
  pctOfValid: number;
  mandatesWon: number;
};
export type LocalMuniBundle = {
  cycle: string;
  obshtinaCode: string;
  obshtinaName: string;
  oblastName: string;
  protocol: {
    numRegisteredVoters: number;
    totalActualVoters: number;
    numValidVotes: number;
  };
  mayor: {
    round1: LocalCandidate[];
    round2: LocalCandidate[];
    elected: LocalCandidate | null;
  };
  council: LocalCouncilParty[];
  kmetstva: unknown[];
  districts: unknown[];
};

export const fetchLocalIndex = (cycle: string): Promise<LocalIndex> =>
  fetchData<LocalIndex>(`/${cycle}/index.json`);

export const fetchLocalMuni = (
  cycle: string,
  obshtinaCode: string,
): Promise<LocalMuniBundle> =>
  fetchData<LocalMuniBundle>(`/${cycle}/municipalities/${obshtinaCode}.json`);
