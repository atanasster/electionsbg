// Shared types for the council ingest pipeline. The wire shape mirrors the
// frontend `CouncilResolutionRow` type in src/data/council/useCouncilHub.tsx
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
  /**
   * Aggregate tally — ABSENT when none could be attributed to the council.
   *
   * Never a zero one: `0 against` asserts a unanimity the source never
   * recorded, and both consumers already implement that invariant —
   * `TallyLine` suppresses on `tally.for == null`, and the PG loader writes
   * `tally_for: r.tally?.for ?? null`. A `method: "none"` escape hatch was
   * once described here and is not the mechanism: no record in the corpus
   * carries it, while 873 carry no tally field at all.
   */
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

/**
 * One protocol — or one enumeration step — that did not make it into the
 * result. These are not merely log lines: the orchestrator reads `kind`
 * and `date` to decide how far the per-município `sinceDate` watermark may
 * advance, and parsers filter candidates on `date > sinceDate`. Get them
 * wrong and the protocol is dropped from every future run, silently.
 *
 * `kind` is REQUIRED, and the union is discriminated, precisely because
 * the two are easy to get wrong invisibly: when it was optional, three
 * parsers shipped per-protocol failures with neither field and froze their
 * own watermark for months without anything going red. Choosing the
 * variant forces the call site to answer the question the watermark asks.
 */
export type MuniScrapeError =
  /**
   * An ENUMERATION step failed — a year index, a CDX query, a category
   * page. It carries no date by construction: what it hid is unknowable,
   * so the watermark freezes rather than advancing past an unknown gap.
   */
  | { kind: "discovery"; url: string; message: string; date?: never }
  /**
   * One protocol could not be RETRIEVED, so it is missing. Holds the
   * watermark strictly below `date` and the next run rediscovers it.
   * `date` is optional only because some parsers learn the sitting date
   * from inside the document — an undated one freezes rather than caps,
   * which is correct but coarse, so supply it whenever it is in scope.
   */
  | { kind: "fetch"; url: string; date?: string; message: string }
  /**
   * Retrieved, but unusable by this parser as it stands — a scanned PDF
   * with no text layer, an unsupported file variant. The protocol is
   * still missing, but retrying identically will never help, so the
   * watermark is allowed past it and it goes on the deferred ledger
   * instead. That ledger is what keeps "skipped" from becoming
   * "forgotten".
   */
  | { kind: "content"; url: string; date?: string; message: string }
  /**
   * The protocol ITSELF was ingested; only an optional enrichment failed
   * (a per-councillor protokol, an OCR unlock, the roster join). Nothing
   * is missing from the resolution set, so this neither holds the
   * watermark nor defers — it is reported in the run output and nowhere
   * else.
   */
  | { kind: "enrich"; url: string; date?: string; message: string };

/** Output of one município scrape, before the index merger consolidates. */
export type MuniScrapeResult = {
  obshtinaCode: string;
  resolutions: CouncilResolution[];
  /** Total sittings/protocols touched in this run (for progress logs). */
  protocolsTouched: number;
  /** Protocols that did not make it in — see MuniScrapeError. */
  errors: MuniScrapeError[];
  /**
   * How many in-window candidates this run deliberately did NOT look at,
   * because `--max` truncated the list. A dropped candidate raises no
   * error, so without this the watermark would advance past protocols
   * nobody ever fetched — the same permanent loss a failed download
   * causes, minus even the one line of output. Any parser honouring
   * `maxProtocols` must report it.
   *
   * A LOWER BOUND, not necessarily exact: a parser that pages its source
   * rather than enumerating protocols (Plovdiv) can only tell that it
   * stopped early, not by how much. The watermark only asks whether it is
   * non-zero; the number is for the operator.
   */
  candidatesDropped?: number;
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
