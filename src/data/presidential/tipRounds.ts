// The two-round plumbing behind every presidential map's hover card — one copy, used by the
// child, abroad and station maps, so the card cannot list the rounds differently on one map.

import type { RollupEntry, RollupState } from "./useRoundRollup";
import type { PresidentialTipRound } from "@/screens/presidential/PresidentialPlaceTip";

/** Each round's rows by place key. */
export type EntriesByRound = Record<1 | 2, Map<string, RollupEntry>>;

/** The round not on screen. */
export const otherRound = (round: 1 | 2): 1 | 2 => (round === 1 ? 2 : 1);

/** A roll-up's rows by place key — empty until it is ready. */
export const indexRollup = (s: RollupState): Map<string, RollupEntry> =>
  s.status === "ready"
    ? new Map(s.rollup.entries.map((e) => [e.key, e] as const))
    : new Map<string, RollupEntry>();

/** Places the shown round's index and the other round's under their round numbers. */
export const entriesByRound = (
  round: 1 | 2,
  shown: Map<string, RollupEntry>,
  other: Map<string, RollupEntry>,
): EntriesByRound =>
  round === 1 ? { 1: shown, 2: other } : { 1: other, 2: shown };

/** The card's blocks for one place: both rounds in ballot order, the shown round always kept
 *  (so a place that cast nothing still says so) and the other only where it has a row. */
export const tipRounds = (
  byRound: EntriesByRound,
  key: string,
  round: 1 | 2,
): PresidentialTipRound[] =>
  ([1, 2] as const)
    .map((r) => ({ round: r, entry: byRound[r].get(key) }))
    .filter((r) => r.round === round || r.entry);

/** A place's name in the reader's language — `name_en` falls back to `name`, and a place the
 *  catalogue cannot name falls back to its key rather than to an empty heading. */
export const localizedName = (
  info: { name?: string; name_en?: string } | undefined,
  isBg: boolean,
  key: string,
): string => (isBg ? info?.name : info?.name_en) || info?.name || key;
