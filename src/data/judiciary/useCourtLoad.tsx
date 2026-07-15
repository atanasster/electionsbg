// Per-court ДЕЙСТВИТЕЛНА натовареност (cases per judge per month), geolocated —
// the input to the court-load map on /judiciary. Served from Postgres (schema
// 069_court_load, loaded from data/judiciary/court_load.json) ONE YEAR AT A TIME via
// court_load_year(): the map fetches ~34 KB for the selected year instead of the
// 531 KB all-years JSON.

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "./fetchJson";

export interface CourtLoad {
  name: string;
  /** One of the six caseload tiers (apelativni · voenni · okrazhni · rs_oblast ·
   *  rs_izvan · administrativni). */
  tier: string;
  place: string | null;
  /** [lng, lat] settlement centroid; null if the town could not be geocoded. */
  loc: [number, number] | null;
  judges: number;
  personMonths: number;
  /** ДЕЙСТВИТЕЛНА натовареност — cases per judge per month. */
  filedPerMonth: number;
  considerPerMonth: number;
  resolvedPerMonth: number;
}

export interface CourtLoadYear {
  year: number;
  courts: CourtLoad[];
}

/** The three per-judge-per-month indicators the map can colour by. */
export type LoadMetric =
  | "filedPerMonth"
  | "considerPerMonth"
  | "resolvedPerMonth";

/** One year's courts (per-year fetch from court_load_year). Disabled until a year
 *  is known (the page scope resolves it from caseload.json). */
export const useCourtLoad = (year: number | null | undefined) =>
  useQuery({
    queryKey: ["judiciary", "court_load", year] as const,
    queryFn: () => fetchJson<CourtLoadYear>(`/api/db/court-load?year=${year}`),
    enabled: year != null,
    staleTime: Infinity,
  });
