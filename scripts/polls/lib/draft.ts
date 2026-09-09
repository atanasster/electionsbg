// Tier 2c/2d — the inbox draft shape (decision 7, §6.2). Every agency
// extractor produces one of these; `polls:extract` (not yet built) writes
// it to `data/polls/_inbox/<pollId>.json`, and `polls:accept` (not yet
// built) is the only thing that may promote it into the corpus.

import type {
  Poll,
  PollDetail,
  PollGenre,
  PollResidual,
  Race,
} from "../../../src/data/polls/pollsTypes";
import type { Refusal } from "./evidence_gate";

/**
 * Everything about a Poll an extractor could confidently resolve.
 * `id`/`agencyId` are always present — an extractor always knows which
 * agency it is and can always mint SOME id (§6.2's fieldwork-keyed id when
 * the fieldwork resolved, a `<agency>-pub-<pubId>` placeholder otherwise,
 * flagged in `refused`). Every other field is OPTIONAL rather than
 * fabricated: `methodology` in particular needs an ENGLISH translation no
 * evidence-gate check can verify against a Bulgarian source quote, so it
 * is left for a human to fill in at `polls:accept` time, same as an
 * unresolved `respondents`/`fieldwork`.
 */
export type DraftPoll = Partial<Omit<Poll, "locked" | "id" | "agencyId">> &
  Pick<Poll, "id" | "agencyId">;

export interface InboxDraft {
  race: Race;
  poll: DraftPoll;
  details: PollDetail[];
  /** Presidential-only (decision 10/16) — Tier 4 has not shipped its shape
   *  yet, so this stays untyped rather than guessing one. */
  runoffs?: unknown[];
  residual: PollResidual | null;
  genre: PollGenre;
  /** The agency id (a deterministic extractor) or "gemini-flash" (the LLM
   *  fallback, decision 5's "< 3 shares" trigger — not yet built). */
  extractor: string;
  /** field name → the verbatim quote that grounds it — every ACCEPTED
   *  claim, mirroring `PollProvenance.quotes`. */
  evidence: Record<string, string>;
  /** Every claim the gate refused, with why — decision 5's "a draft with
   *  zero accepted shares is still written" contract; the operator reviews
   *  this list rather than being told nothing was found. */
  refused: Refusal[];
}
