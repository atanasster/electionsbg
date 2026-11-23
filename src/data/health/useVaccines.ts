// Data hooks for /sector/health/vaccines (docs/plans/vaccines-flow-v1.md T5).
//
// Both routes degrade a missing migration 206 to `null` (never `[]`), so a
// `null` here means "not loaded on this database" and the page says so. Every
// request THROWS on a failed response: a failed fetch must not render as
// "no shots recorded".

import { useQuery } from "@tanstack/react-query";

/** Each source's own clock: the НЗИС fetch time, Eurostat's `updated` stamp… */
export type VaccineAsOf = Partial<
  Record<
    | "his_daily"
    | "his_monthly"
    | "ial_shortage"
    | "ncipd_flu"
    | "season_plan"
    | "eurostat_trade"
    | "eurostat_coverage",
    string
  >
>;

export interface VaccinePlanRow {
  id: string;
  channel: string;
  doses: number;
  /** "over" = „над" — the figure is a floor the source gave. */
  qualifier: string | null;
  /** "delivery" = one delivery, not a season total. */
  scope: string | null;
  basis: "planned" | "contracted" | "announced" | string;
  /** The channel this figure sits inside, when the source says so. */
  within: string | null;
  source: string;
  sourceUrl: string;
  sourceDate: string;
  supersededBy: string | null;
}

export interface VaccineEvent {
  date: string;
  kind: string;
  textBg: string;
  textEn: string;
  sourceUrl: string;
}

export interface VaccineCurvePoint {
  month: string;
  /** Month of season, August = 1. */
  m: number;
  n: number;
  cum: number;
}

export interface VaccineDailyPoint {
  from: string;
  asOf: string | null;
  n: number;
}

export interface VaccineAgeRow {
  ageBand: string;
  ageOrder: number;
  flu: number | null;
  fluNasal: number | null;
}

export interface VaccinesOverview {
  season: number;
  seasons: number[];
  asOf: VaccineAsOf;
  monthlyThrough: string | null;
  curve: {
    basis: string;
    asOf: string | null;
    seasons: { season: number; points: VaccineCurvePoint[] }[];
    daily: VaccineDailyPoint[] | null;
  };
  plan: {
    basis: string;
    asOf: string | null;
    rows: VaccinePlanRow[];
    events: VaccineEvent[];
  };
  recorded: {
    basis: string;
    asOf: string | null;
    through: string | null;
    total: number;
    completeThrough: string | null;
    completeTotal: number | null;
    sameMonthsLastSeason: number | null;
    seasonToDate: number | null;
    seasonToDateAsOf: string | null;
    seasonToDateBasis: string;
    byAge: VaccineAgeRow[];
  };
  shortage: {
    basis: string;
    asOf: string | null;
    firstWindow: string | null;
    weeks: {
      validFrom: string;
      validTo: string;
      products: number;
      vaccines: string[];
    }[];
  };
  incidence: {
    basis: string;
    asOf: string | null;
    weeks: {
      weekStart: string;
      isoWeek: number;
      cases: number;
      ratePer10k: number;
    }[];
    virology: {
      weekStart: string;
      tested: number | null;
      aH1n1: number | null;
      aH1n1pdm09: number | null;
      aH3n2: number | null;
      bVictoria: number | null;
      bYamagata: number | null;
    }[];
  };
  imports: {
    basis: string;
    asOf: string | null;
    monthly: { month: string; eur: number }[];
    partners: { partner: string; eur: number }[];
  };
  contracts: {
    basis: string;
    awarderEik: string;
    /** NULL when the procurement corpus is absent on this database. */
    rows:
      | {
          year: number;
          supplierEik: string;
          supplierName: string;
          contracts: number;
          eur: number;
        }[]
      | null;
  };
  euCoverage: {
    basis: string;
    asOf: string | null;
    rows: { geo: string; year: number; pct: number }[];
  };
}

/** Per-oblast recorded flu shots; both seasons cut to `completeThrough`. */
export interface VaccinesOblast {
  season: number;
  family: string;
  basis: string;
  population: string;
  asOf: string | null;
  completeThrough: string | null;
  rows: VaccineOblastRow[];
}

export interface VaccineOblastRow {
  oblastCode: string;
  nameBg: string;
  nameEn: string;
  n60: number | null;
  pop60: number | null;
  per1000: number | null;
  prevN60: number | null;
  prevPer1000: number | null;
  octN: number | null;
  prevOctN: number | null;
}

const getJson = async <T>(route: string, qs: string): Promise<T> => {
  const r = await fetch(`/api/db/${route}${qs ? `?${qs}` : ""}`);
  if (!r.ok) throw new Error(`${route} -> ${r.status}`);
  return r.json() as Promise<T>;
};

/** The whole page. `season` null = the latest season the data holds. */
export const useVaccinesOverview = (season: number | null) =>
  useQuery({
    queryKey: ["db", "vaccines-overview", season] as const,
    queryFn: () =>
      getJson<VaccinesOverview | null>(
        "vaccines-overview",
        season === null ? "" : `season=${season}`,
      ),
    staleTime: Infinity,
  });

/** Recorded flu shots per oblast for the season the overview resolved. */
export const useVaccinesOblast = (season: number | null) =>
  useQuery({
    queryKey: ["db", "vaccines-oblast", season] as const,
    queryFn: () =>
      getJson<VaccinesOblast | null>(
        "vaccines-oblast",
        `season=${season}&family=flu_all`,
      ),
    enabled: season !== null,
    staleTime: Infinity,
  });
