// Access to the bundled, cross-election dataset (src/data/json/elections.json).
//
// This file is small (~84 KB) and baked into the bundle, so the highest-value
// cross-election questions (turnout / machine-vote trends, per-party national
// votes) are answered with ZERO network calls.

import electionsJson from "../../src/data/json/elections.json";
import type { ElectionInfo } from "../../src/data/dataTypes";

// Newest first (index 0 = latest election), exactly as the main app consumes it.
export const ALL_ELECTIONS = electionsJson as unknown as ElectionInfo[];

export const electionNames = (): string[] => ALL_ELECTIONS.map((e) => e.name);

export const latestElection = (): string => ALL_ELECTIONS[0].name;

export const electionByName = (name: string): ElectionInfo | undefined =>
  ALL_ELECTIONS.find((e) => e.name === name);

export const isKnownElection = (name: string): boolean =>
  ALL_ELECTIONS.some((e) => e.name === name);

// Newest-first slice of the last N elections.
export const lastNElections = (n: number): ElectionInfo[] =>
  ALL_ELECTIONS.slice(0, Math.max(1, Math.min(n, ALL_ELECTIONS.length)));

// Oldest -> newest, for left-to-right time series / charts.
export const electionsChrono = (): ElectionInfo[] =>
  [...ALL_ELECTIONS].reverse();

// ---- derived per-election metrics (pure, from the bundled protocol) ---------

export const turnoutPct = (e: ElectionInfo): number | null => {
  const p = e.results?.protocol;
  if (!p || !p.numRegisteredVoters) return null;
  return round2((100 * p.totalActualVoters) / p.numRegisteredVoters);
};

// Machine valid votes as a share of all valid votes.
// protocol.numValidVotes == paper valid votes; numValidMachineVotes == machine.
export const machinePct = (e: ElectionInfo): number | null => {
  const p = e.results?.protocol;
  if (!p) return null;
  const machine = p.numValidMachineVotes ?? 0;
  const paper = p.numValidVotes ?? 0;
  const denom = machine + paper;
  if (denom <= 0) return null;
  return round2((100 * machine) / denom);
};

export const hadMachineVoting = (e: ElectionInfo): boolean =>
  Boolean(e.hasSuemg) || (e.results?.protocol?.numValidMachineVotes ?? 0) > 0;

// Total valid party votes for an election (sum across parties), used to derive
// per-party national percentages without fetching national_summary.
export const totalPartyVotes = (e: ElectionInfo): number =>
  (e.results?.votes ?? []).reduce((s, v) => s + (v.totalVotes ?? 0), 0);

export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const round2 = (n: number): number => Math.round(n * 100) / 100;
