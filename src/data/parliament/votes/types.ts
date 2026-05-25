// Client-facing types for roll-call vote data. Mirror the on-disk shape
// written by scripts/parliament/scrape_rollcall.ts and the derived metrics
// runner in scripts/parliament/derived/. Keep this in sync with those
// scripts — the data files are the contract.
//
// MP id note: every id in this module is the per-NS parliament.bg id used
// in the roll-call CSV (textbox7 column). It matches MpIndexEntry.id for
// MPs currently seated, but for older NSes the same person can have a
// different id. Join on the per-vote SessionFile.mpParty / mpNames maps,
// not on the deduped roster id.

export type VoteValue = "yes" | "no" | "abstain" | "absent";

export interface VoteRecord {
  mpId: number;
  vote: VoteValue;
}

export interface SessionTallies {
  yes: number;
  no: number;
  abstain: number;
  absent: number;
}

export interface SessionItem {
  item: number;
  tallies: SessionTallies;
  votes: VoteRecord[];
}

export interface SessionFile {
  ns: string;
  date: string;
  stenogramId: number;
  scrapedAt: string;
  unresolvedMpIds?: number[];
  mpNames?: Record<string, string>;
  mpParty?: Record<string, string>;
  // Best-effort per-item bill title keyed by stringified item number ("1", "2"…).
  // Missing keys are normal — render an outcome-derived label as the fallback.
  itemTitles?: Record<string, string>;
  // Per-item slug ("${itemNo}-${slug}") used to build canonical
  // /votes/:date/item-:slug share URLs. Derived from the normalized title;
  // missing keys fall back to the bare item number on read.
  itemSlugs?: Record<string, string>;
  // Coarse topic tag per item (see VoteTopic). Missing keys default to "other".
  itemTopics?: Record<string, VoteTopic>;
  // Absolute URL of the per-MP roll-call PDF on parliament.bg for this day.
  // Used as a "Виж в parliament.bg" deep-link from the session screen.
  pdfUrl?: string;
  sessions: SessionItem[];
}

export type VoteTopic =
  | "confidence_vote"
  | "ratification"
  | "constitution"
  | "personnel"
  | "budget"
  | "zkpo"
  | "tax"
  | "zid"
  | "other";

export type VoteOutcome =
  | "passed_unanimous"
  | "passed"
  | "rejected_unanimous"
  | "rejected"
  | "abstain_unanimous"
  | "contested";

// Flat per-item snapshot used by global vote search and the contested-votes
// feed on /votes. One entry per cast item, sorted newest-first within each
// NS slice. Title is omitted when the session itself had no titles parsed.
export interface TopicEntry {
  date: string;
  item: number;
  slug: string;
  title?: string;
  topic: VoteTopic;
  tally: { yes: number; no: number; abstain: number };
  outcome: VoteOutcome;
  contestScore: number;
}

export interface TopicIndexSlice {
  entries: TopicEntry[];
}

export interface TopicIndexFile {
  computedAt: string;
  byNs: Record<string, TopicIndexSlice>;
}

export interface RollcallIndexEntry {
  date: string;
  stenogramId: number;
  items: number;
  file: string;
  // Parliament-number folder this session belongs to ("51", "52", …). Lets
  // the SPA scope the sessions list to the user's selected election. Optional
  // for backward compat — older index files written before this field can
  // still load, just without per-entry scoping.
  ns?: string;
}

// Per-NS roster snapshot embedded in the index — mpNames + mpParty for the
// latest session of each parliament. Lets tiles avoid fetching the ~100 KB
// session JSON when they only need name / party lookup.
export interface MpProfileSlice {
  mpNames: Record<string, string>;
  mpParty: Record<string, string>;
}

export interface RollcallIndexFile {
  scrapedAt: string;
  ns: string;
  lastStenogramId: number;
  lastDate: string;
  mpProfileByNs?: Record<string, MpProfileSlice>;
  sessions: RollcallIndexEntry[];
}

export interface LoyaltyEntry {
  mpId: number;
  partyShort: string;
  votesCast: number;
  withParty: number;
  loyaltyPct: number;
}

// Per-NS slice of the loyalty metric. The derived runner emits one of these
// per parliament so that selecting an election in the SPA scopes the data
// correctly (ИТН appears in the 51st-NS slice but not in the 52nd-NS one).
export interface LoyaltySlice {
  windowFrom: string;
  windowTo: string;
  totalVoteItems: number;
  entries: LoyaltyEntry[];
}

export interface LoyaltyFile {
  computedAt: string;
  byNs: Record<string, LoyaltySlice>;
}

export interface SimilarityPeer {
  mpId: number;
  score: number;
  overlap: number;
}

export interface SimilarityEntry {
  mpId: number;
  topK: SimilarityPeer[];
  // Most-different peers — lowest cosine scores ascending. Optional so older
  // similarity.json files (pre-bottom-K) still parse.
  bottomK?: SimilarityPeer[];
}

export interface SimilaritySlice {
  topK: number;
  entries: SimilarityEntry[];
}

export interface SimilarityFile {
  computedAt: string;
  byNs: Record<string, SimilaritySlice>;
}

// Per-MP dissent record — emitted by scripts/parliament/derived/dissents.ts.
// One DissentItem per item where the MP's cast vote differed from the
// party-plurality vote at that time.
export interface DissentItem {
  date: string;
  item: number;
  slug: string;
  title?: string;
  topic?: VoteTopic;
  mpVote: "yes" | "no" | "abstain";
  majorityVote: "yes" | "no" | "abstain";
  groupSize: number;
}

export interface DissentEntry {
  mpId: number;
  partyShort: string;
  totalCast: number;
  dissentCount: number;
  recent: DissentItem[];
}

export interface DissentSlice {
  entries: DissentEntry[];
}

export interface DissentFile {
  computedAt: string;
  byNs: Record<string, DissentSlice>;
}

// Top items where two parliamentary groups voted opposite ways. Pair key is
// "${partyA}__${partyB}" with the two short names sorted alphabetically;
// double-underscore avoids colliding with party names that contain hyphens
// (e.g. "ГЕРБ-СДС").
export interface PartyPairBreakItem {
  date: string;
  item: number;
  slug: string;
  title?: string;
  topic?: VoteTopic;
  voteA: "yes" | "no" | "abstain";
  voteB: "yes" | "no" | "abstain";
  contestScore: number;
}

export interface PartyPairBreaksSlice {
  pairs: Record<string, PartyPairBreakItem[]>;
}

export interface PartyPairBreaksFile {
  computedAt: string;
  byNs: Record<string, PartyPairBreaksSlice>;
}

// Per-MP shard. One JSON file per (NS, CSV-id) pair containing everything
// the candidate page tile needs in a single small payload.
export interface MpShard {
  mpId: number;
  ns: string;
  partyShort: string;
  loyalty: {
    votesCast: number;
    withParty: number;
    loyaltyPct: number;
    windowFrom: string;
    windowTo: string;
    totalVoteItems: number;
  };
  dissents: {
    totalCast: number;
    dissentCount: number;
    recent: DissentItem[];
  };
  similarity: {
    topK: SimilarityPeer[];
    bottomK: SimilarityPeer[];
  };
}

export interface CohesionEntry {
  partyShort: string;
  itemsCovered: number;
  meanCohesion: number;
  medianCohesion: number;
  membersTracked: number;
}

export interface CohesionSeriesPoint {
  date: string;
  partyShort: string;
  cohesion: number;
  items: number;
}

export interface CohesionSlice {
  entries: CohesionEntry[];
  series: CohesionSeriesPoint[];
}

export interface CohesionFile {
  computedAt: string;
  byNs: Record<string, CohesionSlice>;
}

export interface EmbeddingPoint {
  mpId: number;
  x: number;
  y: number;
}

export interface EmbeddingSlice {
  dim: 2;
  nMps: number;
  nFeatures: number;
  points: EmbeddingPoint[];
}

export interface EmbeddingFile {
  computedAt: string;
  byNs: Record<string, EmbeddingSlice>;
}

export interface PartyCorrelationSlice {
  parties: string[];
  matrix: number[][];
  participation: Record<string, number>;
}

export interface PartyCorrelationFile {
  computedAt: string;
  byNs: Record<string, PartyCorrelationSlice>;
}
