import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type { CohesionEntry, CohesionFile, CohesionSlice } from "./types";

const queryFn = async (): Promise<CohesionFile | undefined> => {
  const response = await fetch(
    dataUrl(`/parliament/votes/derived/cohesion.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

// Strict: return data only for the requested NS. Older elections (pre-roll-
// call cycles) have no slice — falling back to a different NS would paint the
// wrong people (parliament.bg recycles ids across NSes) and the wrong party
// affiliations.
const pickSlice = (
  file: CohesionFile | undefined,
  ns: string | null,
): CohesionSlice | undefined => {
  if (!ns) return undefined;
  return file?.byNs?.[ns];
};

export const useFactionCohesion = () => {
  const { selected } = useElectionContext();
  const { data, isLoading } = useQuery({
    queryKey: ["rollcall_cohesion"] as [string],
    queryFn,
    staleTime: Infinity,
  });

  const ns = electionToNsFolder(selected);
  const slice = pickSlice(data, ns);

  const byParty = useMemo(() => {
    const m = new Map<string, CohesionEntry>();
    for (const e of slice?.entries ?? []) m.set(e.partyShort, e);
    return m;
  }, [slice]);

  return {
    // `file` is aliased to the slice so existing accessors like `entries`,
    // `series` work without callers needing to know about per-NS layering.
    file: slice,
    slice,
    computedAt: data?.computedAt,
    ns,
    entries: slice?.entries ?? [],
    series: slice?.series ?? [],
    byParty,
    isLoading,
  };
};
