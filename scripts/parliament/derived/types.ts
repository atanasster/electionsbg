// Shared types for derived-metric computation. Mirror the on-disk shape
// written by scrape_rollcall.ts (data/parliament/votes/sessions/*.json) and
// scrape_mps.ts (data/parliament/index.json).

export interface SessionVote {
  mpId: number;
  vote: "yes" | "no" | "abstain" | "absent";
}

export interface SessionItemFile {
  item: number;
  tallies: { yes: number; no: number; abstain: number; absent: number };
  votes: SessionVote[];
}

export interface SessionFile {
  ns: string;
  date: string;
  stenogramId: number;
  scrapedAt: string;
  // Optional in v0 session files; required going forward. Per-vote party
  // affiliation is the authoritative source for derived metrics — parliament
  // doesn't expose historical party assignment any other way.
  mpParty?: Record<string, string>;
  mpNames?: Record<string, string>;
  unresolvedMpIds?: number[];
  // Per-item title keyed by stringified item number. Used to collapse
  // re-votes (an item and its "прегласуване") before computing metrics.
  itemTitles?: Record<string, string>;
  sessions: SessionItemFile[];
}
