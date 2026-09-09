// The candidate resolver — decision 16 of
// docs/plans/polls-agency-watchers-v1.md. A presidential poll prints a
// candidate as a bare name, often just two words ("Румен Радев"); a
// cycle's `tickets.json` (ЦИК's own registration,
// `data/<cycle>_pvr/tickets.json`) carries the candidate's own registered
// name — sometimes three parts (a middle patronymic), sometimes two
// (several of the real 2006 tickets carry no patronymic at all) — from
// which each `canonicalKey` is minted ("Румен Георгиев Радев" → "румен
// георгиев радев"). This module folds the poll's name, matches it against
// every ticket's own OUTER two tokens (first + last — the middle
// patronymic, when either side has one, is simply never compared), and
// resolves only when EXACTLY ONE ticket matches.
//
// A name matching two tickets is REFUSED, never graded — the
// `aop_expert_person_links()` rule (CLAUDE.md), for the same reason:
// attributing a poll's numbers to the wrong named individual is the harm
// this exists to prevent. A refused (or pre-registration, when `tickets`
// is empty) name gets a stable PROVISIONAL key instead — disposable, like
// the parliamentary side's `<agency>-pub-<pubId>` poll ids — never a
// permanent alternate identity for a real candidate.
//
// ⚠️ CALLER PRECONDITIONS — `resolveCandidate` is for a genuine candidate
// NAME only:
//   - An abstention row ("Не подкрепям никого") must NOT be passed in —
//     it is handled directly by `resolveCandidate` itself (see
//     `ABSTENTION_PHRASES` below) and returns the fixed key `"none"`, but
//     a caller normalising its own input differently should still special
//     case it rather than relying on the exact phrase list here matching
//     forever.
//   - A placeholder row ("Кандидат на <party>", decision 12 — published
//     before a party has nominated anyone) must NOT be passed in either:
//     there is no person name to resolve, only a party. Mint its key with
//     `placeholderCandidateKey(partyKey)` below instead.
//   - `rawName` must already be an isolated name with no surrounding
//     punctuation (a trailing "." lifted from running prose, a quote
//     mark) — this module folds case/hyphens/whitespace only. A dirty
//     input fails SAFE (falls to a `no-match` provisional key) rather
//     than crashing, but silently, so clean the text before calling this.

import type { CandidateKey } from "../../../src/data/polls/pollsTypes";

/** The minimal shape this module reads off a cycle's `tickets.json` —
 *  deliberately narrower than the real file's `TicketRecord` (which also
 *  carries `number`/`color`/`nominatedBy`/`rounds`/`nickName`), since the
 *  resolver only ever needs a name to fold and match against. */
export interface ResolvableTicket {
  canonicalKey: string;
  president: string;
}

export interface ResolveResult {
  candidateKey: CandidateKey;
  resolved: boolean;
  /** Present only when `resolved` is false. */
  reason?: "no-match" | "ambiguous";
  /** 0 for "no-match", ≥2 for "ambiguous" (counted by DISTINCT
   *  `canonicalKey`, so an accidental duplicate row for the same real
   *  candidate in `tickets.json` cannot manufacture a false refusal).
   *  Present only when `resolved` is false. */
  matchCount?: number;
}

/** Lowercase, hyphen-as-space, whitespace-collapsed — reproduces
 *  `tickets.json`'s own `canonicalKey` byte-for-byte from its `president`
 *  field (verified against all five real cycles' 75 tickets). NFC first,
 *  for the same reason `normHolderName` (src/lib/declarations.ts)
 *  normalises first: a decomposed „й" must not fold unequal to its own
 *  composed form.
 *
 *  ⚠️ A hyphenated LAST name folds to its trailing half only ("Станков-
 *  Расате" → outer tokens "…", "расате" — see `firstAndLastToken`), which
 *  narrows that candidate's effective match signature to one word
 *  shorter than a non-hyphenated three-part name. Verified harmless
 *  against the current 75 real tickets (no same-cycle collision, and the
 *  realistic abbreviated forms "Боян Расате" / "Станков Расате" both
 *  resolve correctly) — but a future cycle adding a SECOND candidate who
 *  shares that trailing half and first name would correctly REFUSE both
 *  (the ambiguity guard below), not silently mismatch. Worth a second
 *  look whenever a new double-barrelled surname is registered. */
export const foldCandidateName = (s: string): string =>
  s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** First and last token of an already-folded name — the match key. Using
 *  the OUTER two tokens regardless of total count is what lets a poll's
 *  two-word "Румен Радев" match a ticket's three-word "Румен Георгиев
 *  Радев" (and, symmetrically, what lets a two-word TICKET like several
 *  of 2006's — "Любен Петров", no patronymic at all — match itself: with
 *  only two tokens, first and last are simply its only two tokens). */
const firstAndLastToken = (folded: string): [string, string] => {
  const tokens = folded.split(" ").filter(Boolean);
  return [tokens[0] ?? "", tokens[tokens.length - 1] ?? ""];
};

/** Stable, disposable provisional key for a name the resolver could not
 *  resolve to exactly one ticket — the SAME slug every time for the same
 *  first+last tokens, so a later re-extraction that still can't resolve
 *  does not mint a new identity each run. */
export const provisionalCandidateKey = (rawName: string): CandidateKey => {
  const [first, last] = firstAndLastToken(foldCandidateName(rawName));
  return `provisional:${first}-${last}`;
};

/** The key for a placeholder row ("Кандидат на <party>", decision 12) —
 *  never routed through `resolveCandidate`, since there is no person name
 *  to fold. `partyKey` is whatever key the parliamentary side already
 *  uses for that party (`src/data/polls/aliases.ts`'s canonical party
 *  keys), so a placeholder and a later NAMED candidate from the same
 *  party never collide: one is `placeholder:пб`, the other a real
 *  `canonicalKey` once the party nominates someone. */
export const placeholderCandidateKey = (partyKey: string): CandidateKey =>
  `placeholder:${foldCandidateName(partyKey).replace(/ /g, "-")}`;

/** The fixed key for a "Не подкрепям никого" (none-of-the-above) row —
 *  decision 10's residual candidate answer. Never a provisional slug: an
 *  abstention is not an unresolved person, and folding the phrase through
 *  the name resolver would mint a phantom "candidate" identity out of
 *  words that were never a name. */
export const NONE_CANDIDATE_KEY: CandidateKey = "none";

const ABSTENTION_PHRASES = ["не подкрепям никого"];

/** Resolve one poll-printed candidate name against a cycle's tickets.
 *  `tickets` is empty before ЦИК registers the cycle (decision 16) — every
 *  name then resolves as provisional, which is the correct state, not a
 *  bug in this function. See the file header for what must NOT be passed
 *  here (an abstention phrase or a placeholder phrase) — this function
 *  still recognises the abstention phrase defensively, but a caller
 *  should special-case it before calling rather than relying on that. */
export const resolveCandidate = (
  rawName: string,
  tickets: readonly ResolvableTicket[],
): ResolveResult => {
  if (ABSTENTION_PHRASES.includes(foldCandidateName(rawName))) {
    return { candidateKey: NONE_CANDIDATE_KEY, resolved: true };
  }

  const [qFirst, qLast] = firstAndLastToken(foldCandidateName(rawName));
  const matches = tickets.filter((t) => {
    const [tFirst, tLast] = firstAndLastToken(foldCandidateName(t.president));
    return tFirst === qFirst && tLast === qLast;
  });
  // Distinct canonicalKey, not distinct rows: a duplicate row for the
  // SAME real candidate (a data-entry accident in tickets.json) must not
  // manufacture a false "ambiguous" refusal.
  const matchedKeys = new Set(matches.map((t) => t.canonicalKey));

  if (matchedKeys.size === 1) {
    return { candidateKey: matches[0].canonicalKey, resolved: true };
  }
  return {
    candidateKey: provisionalCandidateKey(rawName),
    resolved: false,
    reason: matchedKeys.size === 0 ? "no-match" : "ambiguous",
    matchCount: matchedKeys.size,
  };
};
