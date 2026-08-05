// The per-place education blob behind the Governance place-node tiles
// ("Матура в областта" + "Над очакваното"). Fetches
// `education-payload?kind=place&key=<code>` — a few KB — rather than the 647 KB
// directory blob, which a dashboard rendering two tiles must never pull. Built
// by scripts/db/lib/school_places.ts; see docs/plans/education-place-card-v1.md.

import { useQuery } from "@tanstack/react-query";
// The alias rule lives in a plain .ts module because the PRERENDER imports it
// too and must not pull React Query into a build script. Import it from THERE,
// not through this file — re-exporting a non-component from a .tsx costs fast
// refresh on every consumer.
import { resolveEducationPlaceKey } from "./educationPlaceKey";

/** Verdict banding shared with the directory payload. */
export type PlaceVerdict = "above" | "expected" | "under";

export interface EducationPlaceSchool {
  id: string;
  name: string;
  obshtina: string;
  obshtinaName: string;
  score: number;
  n: number;
  predicted: number | null;
  residual: number | null;
  verdict: PlaceVerdict | null;
  vaResidual: number | null;
  vaVerdict: PlaceVerdict | null;
}

export interface EducationPlaceMuni {
  obshtina: string;
  name: string;
  avg: number;
  examinees: number;
  schools: number;
  delta: number | null;
}

export interface EducationPlace {
  grain: "region" | "muni";
  code: string;
  latestYear: number | null;
  avg: number;
  examinees: number;
  schools: number;
  rank: number | null;
  rankOf: number | null;
  nationalAvg: number | null;
  series: { year: number; avg: number; examinees: number; schools: number }[];
  /** Share (%) of graduates ATTENDING a school averaging below 3.00 — not the
   *  share of graduates who failed. */
  shareInFailingSchools: number | null;
  /** Schools with ≥10 graduates in the headline year: the denominator of the
   *  value-added coverage label, and what every ranked list is drawn from. */
  rankable: number;
  byObshtina: EducationPlaceMuni[];
  top: EducationPlaceSchool[];
  /** Empty when the place has too few rankable schools for a distinct tail. */
  bottom: EducationPlaceSchool[];
  above: EducationPlaceSchool[];
  meanResidual: number | null;
  va: {
    covered: number;
    meanResidual: number | null;
    rows: EducationPlaceSchool[];
  };
}

/**
 * The education blob for one place (oblast or obshtina code).
 *
 * Resolves null — and the tiles self-hide — for any place the corpus has no
 * current cohort for: a diaspora МИР, a município with no matura school, or a
 * database where the loader has not run yet. That last case is why this never
 * throws on an empty body: a cloud database mid-rollout should show no
 * education section, not an error.
 */
export const useEducationPlace = (code?: string | null) => {
  const resolved = code ? resolveEducationPlaceKey(code) : null;
  const query = useQuery({
    queryKey: ["education-place", resolved?.key ?? ""],
    queryFn: async (): Promise<EducationPlace | null> => {
      const r = await fetch(
        `/api/db/education-payload?kind=place&key=${encodeURIComponent(
          resolved!.key,
        )}`,
      );
      if (!r.ok) throw new Error("education place fetch failed");
      return r.json(); // null when the place has no blob
    },
    enabled: !!resolved,
    staleTime: Infinity,
  });
  // `place: null` covers three different states, so the flags come with it: a
  // caller that hides an empty place and a failed request identically can never
  // tell "this place has no schools" from "the database is down".
  return {
    place: query.data ?? null,
    aliased: !!resolved?.aliased,
    aliasReason: resolved?.reason ?? null,
    isPending: !!resolved && query.isPending,
    isError: query.isError,
  };
};
