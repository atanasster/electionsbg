// How to summarize one outlet's coverage of ONE subject in a word.
//
// ⚠️ A READING AID, NOT A VERDICT, and the distinction is enforced by the
// caller rendering the actual distribution beside it. An outlet with 3 neutral
// and 2 negative rows is not a negative outlet; `dominantTone` says which way
// its coverage leans, and the ToneBar underneath says what it actually was.

import type { Tone } from "./data";

export const TONE_GROUP_ORDER: Tone[] = [
  "favorable",
  "neutral",
  "unfavorable",
  "mixed",
];

/** How an outlet's coverage of this subject is summarized in the group list. */
export type OutletGroupKind =
  /** Two or more assessed articles, one tone leading. */
  | { kind: "dominant"; tone: Tone }
  /** Exactly one assessed article — "mostly" would be a word too strong. */
  | { kind: "single"; tone: Tone }
  /** Two or more assessed, no single tone leading. */
  | { kind: "split" }
  /** Coverage exists and none of it carries a published tone. */
  | { kind: "unassessed" };

/**
 * The dominant tone, or `null` when no single tone leads.
 *
 * ⚠️ A TIE IS `null`, NEVER THE FIRST ONE. `TONE_GROUP_ORDER` puts
 * `favorable` first, so returning the leader on a tie would make a 1-1 split
 * read as favourable coverage of a named party by a named outlet — a claim
 * produced by an array's order rather than by anything the outlet published.
 */
export const dominantTone = (
  counts: Partial<Record<Tone, number>> | null | undefined,
): Tone | null => {
  if (!counts) return null;
  let best: Tone | null = null;
  let bestN = 0;
  let tied = false;
  for (const tone of TONE_GROUP_ORDER) {
    const n = counts[tone] ?? 0;
    if (!Number.isFinite(n) || n <= 0) continue;
    if (n > bestN) {
      best = tone;
      bestN = n;
      // ⚠️ THE RESET IS LOAD-BEARING. Without it an earlier tie is never
      // cleared, so `{favorable: 1, neutral: 1, unfavorable: 3}` — a clear
      // winner arriving after two equal runners-up — returns `null` instead
      // of `unfavorable`.
      tied = false;
    } else if (n === bestN) {
      tied = true;
    }
  }
  return tied || bestN === 0 ? null : best;
};

/**
 * Which group an outlet belongs in.
 *
 * ⚠️ `assessed`, NOT THE SUM OF `counts`. An outlet whose coverage carries no
 * published tone is `unassessed` — "no single framing" would assert we looked
 * and found none, where the truth is that we published no assessment at all.
 *
 * ⚠️ AND ONE ARTICLE IS NEVER "MOSTLY". „преобладаващо негативен" over a
 * single article is a word the evidence does not reach.
 */
export const outletGroup = (
  counts: Partial<Record<Tone, number>> | null | undefined,
  assessed: number,
): OutletGroupKind => {
  if (!Number.isFinite(assessed) || assessed <= 0)
    return { kind: "unassessed" };
  const tone = dominantTone(counts);
  if (!tone) return { kind: "split" };
  return assessed === 1 ? { kind: "single", tone } : { kind: "dominant", tone };
};

/** A stable key for grouping and for a React list. */
export const outletGroupKey = (group: OutletGroupKind): string =>
  group.kind === "dominant" || group.kind === "single"
    ? `${group.kind}:${group.tone}`
    : group.kind;
