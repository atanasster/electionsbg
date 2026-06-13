// Fetches the per-cycle local "problem sections" report (curated Roma-
// neighborhood polling sections, council ballot) for a given local cycle.
//
// Mirror of useLocalSections — same React-Query convention, same dataUrl seam.
// Present only for regular cycles whose section CSV bundle was ingested AND
// whose addresses were stamped by --local-coords (2011, 2015, 2019, 2023).
// Returns undefined on 404 so the tile self-hides for cycles without it.
//
// Shape mirrors scripts/parsers_local/problem_sections_local.ts. Pre-aggregated
// to per-neighborhood party totals (the tile needs only summed council votes,
// never the per-station breakdown). `localPartyNum` is OIK-scoped, so the
// canonical id is the stable key for cross-cycle comparison.

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useLatestLocalCycle } from "./useLatestLocalCycle";

export type LocalProblemPartyTotal = {
  localPartyNum: number;
  localPartyName: string;
  primaryCanonicalId: string | null;
  color: string;
  votes: number;
};

export type LocalProblemNeighborhood = {
  id: string;
  name_bg: string;
  name_en: string;
  city_bg: string;
  city_en: string;
  source_url: string;
  obshtinaCode: string;
  obshtinaName: string;
  // 2-digit административен район code (section digits 5-6) the neighborhood
  // sits in — the join key for the район drill-down pages (Sofia S2xxx,
  // Пловдив/Варна <muni>-<code>). "00" for общини без районно деление.
  rayonCode: string;
  sectionCount: number;
  numRegisteredVoters: number;
  totalActualVoters: number;
  numValidVotes: number;
  parties: LocalProblemPartyTotal[];
};

export type LocalProblemSectionsReport = {
  cycle: string;
  neighborhoods: LocalProblemNeighborhood[];
};

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  LocalProblemSectionsReport | undefined
> => {
  if (!queryKey[1]) return undefined;
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/problem_sections.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `local problem_sections fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

// `cycle === undefined` defaults to the latest local cycle; pass `null` to
// explicitly disable the query (e.g. the prior-cycle lookup when there is no
// prior cycle) — without this, `undefined` would wrongly fall back to latest
// and the ΔPP comparison would read the wrong cycle.
export const useLocalProblemSections = (cycle?: string | null) => {
  const fallback = useLatestLocalCycle();
  const active = cycle === undefined ? fallback : cycle;
  return useQuery({
    queryKey: ["local_problem_sections", active],
    queryFn,
    enabled: !!active,
    retry: false,
  });
};
