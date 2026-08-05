// The per-place education blob behind the Governance place-node tiles
// ("Матура в областта" + "Над очакваното"). Fetches
// `education-payload?kind=place&key=<code>` — a few KB — rather than the 647 KB
// directory blob, which a dashboard rendering two tiles must never pull. Built
// by scripts/db/lib/school_places.ts; see docs/plans/education-place-card-v1.md.

import { useQuery } from "@tanstack/react-query";
import { SOFIA_REGIONS } from "@/data/dataTypes";

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

/** МОН publishes Столична община as ONE aggregate, so the corpus knows Sofia
 *  city as oblast `S23` / obshtina `SOF00` (`load_schools_pg.ts` maps `SOF00 →
 *  S23`). Parliament splits the city into three МИР (`SOFIA_REGIONS`), each
 *  with its own region page, and all three read that one city-wide blob.
 *
 *  `S23` therefore needs the disclosure just as much as `S24` and `S25` do: the
 *  key matching the requested code is a COLLISION between the МИР code and the
 *  city aggregate's key, not evidence that the numbers are that МИР's. Deriving
 *  the note from `key !== code` gave the page headed "София 23 МИР" the whole
 *  city's matura average with nothing said. */
const SOFIA_CITY_KEY = SOFIA_REGIONS[0];

/** Plovdiv's МИР split is the same shape: `PDV-00` is the city constituency,
 *  while the education cut folds the city into the `PDV` oblast. */
const PLOVDIV_CITY_MIR = "PDV-00";
const PLOVDIV_OBLAST = "PDV";

/** Why a place reads a BROADER aggregate than itself — the caller needs the
 *  REASON, not just the fact, because the two get different sentences ("МОН
 *  publishes Sofia city as one aggregate" vs "…Plovdiv province as one").
 *  Returning it here is what keeps the МИР lists from being re-derived at every
 *  call site. */
export type PlaceAliasReason = "sofia-city" | "plovdiv-province" | null;

export interface PlaceKey {
  /** The code actually fetched. */
  key: string;
  /** True when the numbers are a broader aggregate's, whether or not `key`
   *  differs from the requested code — see the Sofia note above. */
  aliased: boolean;
  reason: PlaceAliasReason;
}

/** Resolve a place code onto the code the education corpus is keyed by. */
export const resolveEducationPlaceKey = (code: string): PlaceKey => {
  if (SOFIA_REGIONS.includes(code))
    return { key: SOFIA_CITY_KEY, aliased: true, reason: "sofia-city" };
  if (code === PLOVDIV_CITY_MIR)
    return { key: PLOVDIV_OBLAST, aliased: true, reason: "plovdiv-province" };
  return { key: code, aliased: false, reason: null };
};

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
