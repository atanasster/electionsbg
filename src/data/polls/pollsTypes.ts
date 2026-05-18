export type Lang = { en: string; bg: string };

export type Agency = {
  id: string;
  website: string | null;
  name_bg: string;
  name_en: string;
  abbr_bg: string;
  abbr_en: string;
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
 *   - agency_spreadsheet: agency-provided summary file (e.g. ML/Galya xlsx)
 *   - agency_pdf:         agency-published PDF report supplied manually
 *   - agency_website:     citation hosted on the agency's own primary domain
 */
export type PollLock = {
  by: "agency_spreadsheet" | "agency_pdf" | "agency_website";
  note?: string;
  lockedAt: string;
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
};

export type PollDetail = {
  pollId: string;
  agencyId: string;
  support: number;
  nickName_bg: string;
  nickName_en: string;
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
