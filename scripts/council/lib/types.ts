// Shared types for the council ingest pipeline. The wire shape mirrors the
// frontend `CouncilResolution` type in src/data/council/useCouncilMinutes.tsx
// — the `tally` block is Phase 1's addition. Keep the two in lock-step.

export type CouncilTag =
  | "financial"
  | "personnel"
  | "urban_planning"
  | "procurement"
  | "social"
  | "other";

export type CouncilTallyMethod = "named" | "open" | "secret" | "none";

export type CouncilTally = {
  /** Vote counts. Bulgarian protocols use "няма" / "-" for zero — both map to 0. */
  for: number;
  against: number;
  abstain: number;
  /**
   * How the vote was conducted. "named" = поименно (per-councillor list
   * present); "open" = явно (aggregate only, no per-councillor data);
   * "secret" = тайно (no public tally at all); "none" = aклематично or
   * unparseable (tally fields then unreliable).
   */
  method: CouncilTallyMethod;
  /** When `method: "named"`, this carries the per-councillor breakdown that
   * Phase 2 joins to the officials roster. Phase 1 leaves it undefined. */
  perCouncillor?: Array<{
    name: string;
    /** Normalised key for roster join (lowercase, no spaces, no diacritics). */
    normKey: string;
    vote: "for" | "against" | "abstain";
  }>;
};

export type CouncilTallyResult =
  | "adopted"
  | "rejected"
  | "returned"
  | "unknown";

export type CouncilResolution = {
  /** Stable id: `{obshtinaCode}-{YYYY}-prot{protocolNumber}-r{resolutionNumber}`. */
  id: string;
  /** ISO date (YYYY-MM-DD) of the council sitting. */
  date: string;
  /** Council session number, e.g. "20" (no padding). */
  session: string;
  /** Resolution number within that mandate, e.g. "449". */
  number: string;
  /** Decision title (ОТНОСНО: text), trimmed. */
  title: string;
  /** Aggregate tally. Always present, but `method: "none"` when unparseable. */
  tally?: CouncilTally;
  /** Adopted / rejected / returned (чл.45 ЗМСМА governor veto) / unknown. */
  result: CouncilTallyResult;
  /** Direct URL to the source artefact (PDF/DOCX/HTML) the tally was lifted from. */
  sourceUrl: string;
  /** Filled in by the Phase 4 summary pass (Gemini). Empty in Phase 1. */
  summary_bg?: string;
  summary_en?: string;
  tags?: CouncilTag[];
};

/** Recipe entry in data/council/sources.json. */
export type MuniRecipe = {
  name: string;
  tier: "A" | "B" | "C";
  indexUrl: string;
  indexNote?: string;
  fetch: "static" | "playwright";
  format: "pdf-text" | "docx" | "doc" | "html" | "mixed" | "pdf-scan";
  tallyStrategy: string;
  samplePdf?: string;
  perCouncillor?: boolean;
  phase1Defer?: boolean;
  deferReason?: string;
  // Per-município pattern hints surfaced via the recipe so the parser does
  // not need to hard-code URL fragments. Optional — the parser may use its
  // own heuristics if these are absent.
  yearIndexPattern?: string;
  decisionUrlPattern?: string;
  fileUrlPattern?: string;
  uploadPathPattern?: string;
  nodeIdPattern?: string;
};

export type SourcesFile = {
  schemaVersion: number;
  note?: string;
  tallyRegexes: unknown;
  munisByObshtina: Record<string, MuniRecipe>;
  phase3OcrCandidates?: string[];
  phase3Sliven?: MuniRecipe & { obshtinaCode: string };
};

/** Output of one município scrape, before the index merger consolidates. */
export type MuniScrapeResult = {
  obshtinaCode: string;
  resolutions: CouncilResolution[];
  /** Total sittings/protocols touched in this run (for progress logs). */
  protocolsTouched: number;
  /** Skipped/failed protocol urls — surfaced in the summary, not retried. */
  errors: Array<{ url: string; message: string }>;
};

/** Shape of the existing data/council/index.json that the React hook reads. */
export type CouncilIndexFile = {
  source: string;
  indexName: string;
  tags: Record<CouncilTag, { bg: string; en: string }>;
  resolutionsByObshtina: Record<string, CouncilResolution[]>;
  note?: string;
  /** Per-município metadata for UI / ingest summary; written by index_writer. */
  meta?: Record<
    string,
    {
      name: string;
      lastIngest: string; // ISO
      protocolsIngested: number;
      resolutionCount: number;
    }
  >;
};
