export type Lang = { en: string; bg: string };

export type Agency = {
  id: string;
  website: string | null;
  name_bg: string;
  name_en: string;
  abbr_bg: string;
  abbr_en: string;
  // ЕИК of the agency's legal entity in the Commerce Registry, when confidently
  // resolved. Enables deep-links to /company/:eik (public procurement + EU funds).
  // Left unset for agencies we could not pin to a single TR entity (e.g. Mediana).
  eik?: string | null;
};

export type PollGenre =
  | "raw_attitudes"
  | "forecast"
  | "both_published"
  | "unclear";

export type PollResidual = {
  undecided: number | null;
  wontVote: number | null;
  wontSay: number | null;
  otherNamedMinor: number | null;
  notes?: string;
};

/**
 * Provenance for a confirmed poll that the scraper must never overwrite.
 * Tiered by source authority:
 *   - agency_spreadsheet:    agency-provided cross-poll summary spreadsheet
 *   - agency_pdf:            agency-published PDF report supplied manually
 *   - agency_website:        citation hosted on the agency's own primary domain
 *   - third_party_consensus: agency did not archive a primary; numbers
 *                            verified across multiple independent press
 *                            citations that all agree on the same figures
 */
export type PollLock = {
  by:
    | "agency_spreadsheet"
    | "agency_pdf"
    | "agency_website"
    | "third_party_consensus";
  note?: string;
  lockedAt: string;
  // Recorded by `polls:accept --replace` when a locked poll is overwritten —
  // decision 7. Absent on every poll that has never been superseded.
  // Deliberately the FULL prior `Poll` (not a flattened summary) — a poll
  // corrected more than once nests each generation inside the next, which
  // is the intended shape for a rare, manual, exceptional path: a full
  // audit trail of every prior value, not just the immediately-previous one.
  supersedes?: { pollId: string; poll: Poll; details: PollDetail[] };
};

// A poll's electoral family (docs/plans/polls-agency-watchers-v1.md decision
// 10) — presidential polls live in a SEPARATE file family
// (`data/polls/presidential/`), never mixed with parliamentary ones, but
// share this one type module rather than each family forking its own copy
// (decision 14).
export type Race = "parliamentary" | "presidential";

/**
 * Where a poll's numbers came from, and the evidence for each one — decision
 * 5 (every share/passport field is quote-grounded) and decision 7 (an
 * auto-extracted poll is provenance-visible, never silently trusted).
 * Written by the Tier 2 extractor into the inbox draft; carried unchanged
 * into `Poll.provenance` by `polls:accept`.
 */
export type PollProvenance = {
  url: string;
  archiveUrl?: string;
  fetchedAt: string;
  sha256: string;
  // The agency id (deterministic extractor) or "gemini-flash" (LLM fallback,
  // decision 5's "< 3 shares" trigger).
  extractor: string;
  fieldworkStart: string | null;
  fieldworkEnd: string | null;
  // The exact sentence the genre was decided from (decision 8), verbatim —
  // `null` when no known base phrase matched (`genre: "unclear"`).
  basePhrase: string | null;
  // field name (e.g. "share:ГЕРБ-СДС", "sampleSize") → the verbatim quote
  // that grounds it. Only ACCEPTED claims appear here — a refused one is
  // never silently promoted by carrying its quote along anyway.
  quotes: Record<string, string>;
};

export type Poll = {
  id: string;
  agencyId: string;
  fieldwork: string;
  electionDate: string | null;
  respondents: number | null;
  methodology: Lang;
  source: string;
  genre?: PollGenre;
  residual?: PollResidual | null;
  locked?: PollLock;
  // Omitted on every poll hand-curated before decision 10/14 shipped —
  // absent is read as "parliamentary" (the only family that existed then).
  race?: Race;
  provenance?: PollProvenance;
  // Presidential only (decision 10/11) — the round-1 folder id
  // ("2026_11_08_pvr") once the cycle's results tree exists, `null` while
  // only an estimated electionDate is known. Always absent on a
  // parliamentary poll; never read there.
  cycle?: string | null;
};

export type PollDetail = {
  pollId: string;
  agencyId: string;
  support: number;
  nickName_bg: string;
  nickName_en: string;
};

/**
 * A presidential candidate/abstention/placeholder identity — decision 16's
 * candidate resolver (`scripts/polls/presidential/candidate_resolver.ts`)
 * is the one place any of these are minted; every field below that is
 * typed `CandidateKey` holds exactly one of:
 *   - a real ticket's `canonicalKey` (`tickets.json[].canonicalKey`) once
 *     the resolver matched exactly one candidate;
 *   - `"provisional:<first>-<last>"` before ЦИК registers the tickets, or
 *     when the resolver refused an ambiguous or unmatched name;
 *   - the literal `"none"` for a "Не подкрепям никого" row (decision 10);
 *   - `"placeholder:<partyKey>"` for a row published before a party has
 *     nominated anyone ("Кандидат на <party>", decision 12) — never
 *     resolved as a name at all, since there is no person to fold.
 */
export type CandidateKey = string;

/**
 * A presidential poll's per-candidate row — decision 10's separate file
 * family (`data/polls/presidential/polls_details.json`), never mixed with
 * the parliamentary `PollDetail` above: a presidential row identifies a
 * CANDIDATE, not a party, and candidate identity needs the resolver
 * (decision 16) rather than a bare nickname pair.
 */
export type PresidentialPollDetail = {
  pollId: string;
  agencyId: string;
  candidateKey: CandidateKey;
  candidateName_bg: string;
  // Default `transliterateName(candidateName_bg)` (src/data/candidates/
  // transliterateName.ts — the same Streamlined-System fallback the MP/
  // person pages already use for a name with no curated EN form); a human
  // may override it by hand-editing the draft before accepting, same as
  // `methodology` on the parliamentary side.
  candidateName_en: string;
  nominator: string | null;
  // Set only for a placeholder row ("Кандидат на <party>") published
  // before a party has nominated anyone — the party's own key, decision
  // 12. `null` for every named-candidate row. (`candidateKey` is then
  // `"placeholder:<this value>"` — see `CandidateKey` above.)
  placeholderFor: string | null;
  support: number;
};

/**
 * A runoff pairing published by one poll — decision 10's presidential-only
 * fact, several per poll for an agency polling more than one hypothetical
 * second round. Stored beside `polls_details.json`, never folded into it:
 * a pairing is a joint claim about two candidates, not a per-candidate row.
 */
export type Runoff = {
  pollId: string;
  agencyId: string;
  a: CandidateKey;
  b: CandidateKey;
  supportA: number;
  supportB: number;
  residual: PollResidual | null;
};

/**
 * One cycle's candidate directory (`data/polls/presidential/candidates.json`)
 * — a PROJECTION of that cycle's `tickets.json` plus every provisional key
 * a draft has minted, rebuilt by `polls:presidential:rekey` and never
 * hand-edited (decision 16). `ticketNumber`/`colour` are `null` until ЦИК
 * registers the ticket — there is nothing to score against before then,
 * which is the correct state, not a gap.
 */
export type PresidentialCandidate = {
  candidateKey: CandidateKey;
  name_bg: string;
  // Same `transliterateName()` default as `PresidentialPollDetail`'s
  // `candidateName_en` above.
  name_en: string;
  nominator: string | null;
  ticketNumber: number | null;
  colour: string | null;
};

export type PartyError = {
  key: string;
  polled: number;
  polledRaw?: number;
  actual: number;
  error: number;
};

export type ElectionAgencyError = {
  agencyId: string;
  pollId: string;
  fieldworkEnd: string;
  daysBefore: number;
  respondents: number | null;
  genre?: PollGenre;
  normalization?: { applied: boolean; redistributed: number };
  errors: PartyError[];
  mae: number;
  rmse: number;
  biggestMiss: { key: string; error: number };
};

export type ElectionAccuracy = {
  electionDate: string;
  actualResults: { key: string; pct: number; passedThreshold: boolean }[];
  agencies: ElectionAgencyError[];
};

export type BlocId =
  | "right_govt"
  | "reformist"
  | "nationalist"
  | "left"
  | "minority"
  | "populist"
  | "other";

export type AgencyGrade = "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";

export type AgencyProfile = {
  agencyId: string;
  name_bg: string;
  name_en: string;
  totalPolls: number;
  preElectionPolls: number;
  electionsCovered: string[];
  overallMAE: number;
  overallRMSE: number;
  // Sample-weighted MAE on industry-bias-adjusted errors. Per (election, party)
  // the cross-agency mean error is subtracted from each agency's error before
  // |·|, then per-poll contributions are weighted by √n. Captures skill
  // relative to peers (cycle-wide forecast shocks removed).
  overallMAEAdjusted: number;
  shrunkMAE: number;
  // Adjusted MAE put through the same Bayesian shrinkage as shrunkMAE. The
  // leaderboard sort order and letter grade are derived from this value.
  shrunkMAEAdjusted: number;
  medianDaysBefore?: number | null;
  plusMinus: number | null;
  plusMinusSamples: number;
  barrierCallRate: number | null;
  barrierCallTotal: number;
  grade: AgencyGrade;
  maeHistory: { electionDate: string; mae: number; rmse: number }[];
  partyBias: { key: string; meanError: number; samples: number }[];
  blocLean: Record<BlocId, { meanError: number; samples: number }>;
  houseEffect: { key: string; meanDiff: number; samples: number }[];
};

export type PollsAccuracy = {
  generatedAt: string;
  elections: ElectionAccuracy[];
  agencyProfiles: AgencyProfile[];
};

export type AgencyTake = {
  agencyId: string;
  summary: Lang;
  lean: Lang;
  warning: Lang;
};

export type ElectionNarrative = {
  headlines: { en: string[]; bg: string[] };
  story: Lang;
};

export type PollsAnalysis = {
  generatedAt: string;
  model: string;
  inputAccuracyGeneratedAt: string;
  agencyTakes: AgencyTake[];
  // Per-election narrative keyed by ISO date (e.g., "2026-04-19"). One entry per
  // election in accuracy.elections; each is a focused Gemini call so the headlines
  // and story actually describe *that* election rather than always 2026.
  byElection: Record<string, ElectionNarrative>;
};
