// Култура (culture) data shapes — the НФЦ film-subsidy corpus and its
// precomputed overview. Emitted by scripts/culture/ingest.ts into
// data/culture/*.json, served at /culture/*.json by the Vite data middleware.
// See docs/plans/kultura-view-v1.md (Phase 1).

/** A film-discipline, classified from the НФЦ registration-number letter
 *  (И=игрално, Д=документално, А=анимационно) with a fallback for the rest. */
export type FilmDiscipline = "feature" | "documentary" | "animation" | "other";

/** One financed film/series from the НФЦ Единен публичен регистър. Recipients
 *  are keyed by PRODUCER NAME (no EIK in the source — see plan §6); the raw name
 *  is preserved verbatim and `producerFold` is a normalised grouping key. */
export interface FilmAward {
  year: number;
  title: string;
  regNo: string;
  producer: string;
  producerFold: string;
  discipline: FilmDiscipline;
  /** Production stage where the source states it (Производство/Развитие/…). */
  stage?: string;
  subsidyBgn: number;
  subsidyEur: number;
  /** „Протокол на ФК" — the художествена комисия protocol ref, when published. */
  protocol?: string;
}

export interface CultureSource {
  publisher: string;
  url: string;
  description: string;
}

export interface CultureFilmsFile {
  generatedAt: string;
  source: CultureSource;
  firstYear: number;
  lastYear: number;
  films: FilmAward[];
}

export interface YearBucket {
  year: number;
  eur: number;
  count: number;
}

export interface DisciplineBucket {
  discipline: FilmDiscipline;
  eur: number;
  count: number;
}

export interface ProducerBucket {
  producer: string;
  producerFold: string;
  eur: number;
  count: number;
  /** Share of total НФЦ subsidy across the whole corpus. */
  share: number;
  /** Resolved company EIK — ONLY when the name matches exactly one TR company
   *  (unique match; ambiguous names are left unlinked, per plan §6). Added by
   *  scripts/culture/enrich_producers.ts, absent on the raw ingest. */
  eik?: string;
}

export interface CultureOblastInstitute {
  eik: string;
  name: string;
  settlement: string;
  eur: number;
}

export interface CultureOblastBucket {
  /** Oblast display name (mapped to a canonical code client-side). */
  oblast: string;
  instituteCount: number;
  procurementEur: number;
  institutes: CultureOblastInstitute[];
}

export interface CultureFundingStream {
  id: string;
  bg: string;
  en: string;
  annualEur: number;
  sourceBg: string;
  sourceEn: string;
}

/** Annual culture-money streams by scale — the honest "budget bridge" that puts
 *  the detailed film subsidies in proportion. See write_funding_streams.ts. */
export interface CultureFundingStreamsFile {
  generatedAt: string;
  mkTotalEur: number;
  note: { bg: string; en: string };
  streams: CultureFundingStream[];
}

export interface GrantDisciplineBucket {
  discipline: string;
  label: { bg: string; en: string };
  applied: number;
  funded: number;
  fundedEur: number;
}

export interface GrantProgram {
  code: string;
  year: number;
  label: { bg: string; en: string };
  url: string;
  applied: number;
  funded: number;
  successRate: number;
  requestedEur: number;
  fundedEur: number;
  byDiscipline: GrantDisciplineBucket[];
}

/** НФК grant results — applied vs funded (success rate) per program & discipline.
 *  See scripts/culture/ncf_grants.ts. */
export interface CultureGrantsFile {
  generatedAt: string;
  source: { publisher: string; url: string; description: string };
  totalApplied: number;
  totalFunded: number;
  overallSuccessRate: number;
  totalFundedEur: number;
  totalRequestedEur: number;
  programs: GrantProgram[];
}

/** State cultural institutes located by oblast — reliable (they are awarders
 *  with EIKs, unlike the film producers). See scripts/culture/build_oblast.ts. */
export interface CultureOblastFile {
  generatedAt: string;
  source: { publisher: string; description: string };
  resolvedInstitutes: number;
  totalInstitutes: number;
  oblasts: CultureOblastBucket[];
}

export interface SofiaDirection {
  /** Направление number as printed in the класиране (1–9, non-contiguous). */
  n: number;
  bg: string;
  count: number;
  eur: number;
}

/** Столична програма „Култура" (municipal, outside the state budget) + читалища
 *  national context — the two culture-money streams the /culture view otherwise
 *  only shows as single scale-tile lines. See scripts/culture/sofia_program.ts. */
export interface CultureMunicipalFile {
  generatedAt: string;
  sofia: {
    year: number;
    program: string;
    council: string;
    decision: string;
    appliedCount: number;
    fundedCount: number;
    totalEur: number;
    directions: SofiaDirection[];
    sourceUrl: string;
    note: { bg: string; en: string };
  };
  chitalishta: {
    year: number;
    subsidizedPositions: number;
    positionsYoY: number;
    totalEur: number;
    announcedEur: number;
    cutEur: number;
    sourceBg: string;
    sourceEn: string;
    note: { bg: string; en: string };
  };
}

export interface CommissionMember {
  name: string;
  role: "chair" | "member";
  /** титуляр (full) or резервен (reserve) expert. */
  status: "titular" | "reserve";
  /** Register section under чл. 15 ЗФИ (Режисьори, Продуценти, …). */
  section: string;
}

export interface Commission {
  id: "feature" | "documentary" | "animation";
  bg: string;
  en: string;
  members: CommissionMember[];
}

/** The current НФЦ национални художествени комисии — "кой решава" which films get
 *  state money. Drawn by lottery per 6-month mandate. See write_commissions.ts. */
export interface CultureCommissionsFile {
  generatedAt: string;
  order: string;
  orderUrl: string;
  mandateStart: string;
  mandateEnd: string;
  lotteryDate: string;
  secretary: string;
  director: string;
  note: { bg: string; en: string };
  commissions: Commission[];
}

/** Precomputed dashboard blob so the tiles don't re-aggregate the full corpus
 *  client-side (the discipline-composition, concentration and time-spine tiles
 *  all read from here). */
export interface CultureOverviewFile {
  generatedAt: string;
  source: CultureSource;
  totalEur: number;
  filmCount: number;
  producerCount: number;
  firstYear: number;
  lastYear: number;
  byYear: YearBucket[];
  byDiscipline: DisciplineBucket[];
  /** Top producers by total subsidy, desc — the concentration tile. */
  topProducers: ProducerBucket[];
  /** Share of the corpus held by the top 10 producers — the concentration KPI. */
  top10Share: number;
}
