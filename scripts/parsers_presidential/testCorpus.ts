// Shared reading for the two CROSS-ERA gates — `winnerRule.test.ts` and
// `anchors.test.ts`.
//
// ⚠ It exists for those two and no others. The five per-era suites deliberately share
// nothing but `readerKit`: each pins its own bundle's shapes, and a common helper there
// would let one era's convenience quietly define what another asserts. These two are
// different — they read the SAME ten rounds through the SAME dispatcher, so a second
// copy of the memo is two things to keep in step for no gain.
//
// ⚠ The memo is per (cycle, round) rather than per test file, which is what makes it
// worth having: `anchors.test.ts` alone asks for the corpus about eight times over, and
// each miss is 33 files and 12k sections for 2001.
//
// Plan: docs/plans/presidential-elections-v1.md T2.6.

import { readPresidentialRound } from "./readers";
import {
  PRESIDENTIAL_CYCLES,
  PRESIDENTIAL_SOURCES,
  roundFolderName,
  type RoundNumber,
} from "./sources";
import { tallyRound, type RoundTally } from "./winnerRule";
import type { PresidentialRound } from "./types";

/** The cycle ids oldest first — the order a gate iterating history should use. */
export const CYCLES_OLDEST_FIRST: string[] = [...PRESIDENTIAL_CYCLES].reverse();

/**
 * The rounds a cycle's `sources.ts` entry declares, ascending.
 *
 * ⚠ NOT always `[1, 2]`: a cycle whose runoff ЦИК has not yet published (2026) carries
 * round 1 alone, so a gate that hard-codes both rounds reads a folder that does not exist.
 */
export const cycleRounds = (cycle: string): RoundNumber[] =>
  (
    Object.keys(PRESIDENTIAL_SOURCES[cycle].rounds).map(Number) as RoundNumber[]
  ).sort((a, b) => a - b);

/** The cycles whose runoff is published — every outcome-shaped gate's population. */
export const CYCLES_WITH_RUNOFF: string[] = CYCLES_OLDEST_FIRST.filter((c) =>
  cycleRounds(c).includes(2),
);

/**
 * Every committed round folder, for `assertCommitted`.
 *
 * ⚠ PER ROUND, not per cycle. `assertCommitted` on a directory checks only that it is
 * non-empty, so naming the cycle passes on a tree holding `SOURCE.json` and one round —
 * exactly the half-restored working copy the helper exists to catch.
 */
export const COMMITTED_ROUND_DIRS: string[] = CYCLES_OLDEST_FIRST.flatMap((c) =>
  cycleRounds(c).map((r) => `raw_data/${c}/${roundFolderName(r)}`),
);

const rounds = new Map<string, PresidentialRound>();
const tallies = new Map<string, RoundTally>();

/** One round, read once per process. */
export const corpusRound = (cycle: string, round: 1 | 2): PresidentialRound => {
  const key = `${cycle}/${round}`;
  const hit = rounds.get(key);
  if (hit) return hit;
  const r = readPresidentialRound(cycle, round);
  rounds.set(key, r);
  return r;
};

/** One round's tally, computed once per process. */
export const corpusTally = (cycle: string, round: 1 | 2): RoundTally => {
  const key = `${cycle}/${round}`;
  const hit = tallies.get(key);
  if (hit) return hit;
  const t = tallyRound(corpusRound(cycle, round));
  tallies.set(key, t);
  return t;
};

/** A percentage to two places, as a string, so a test pins the rendered figure. */
export const pct = (x: number): string => (x * 100).toFixed(2);
