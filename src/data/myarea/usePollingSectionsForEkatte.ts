// "Where do I vote" helper. Returns every polling section whose `ekatte`
// matches the resolved settlement, sorted by section number.
//
// The data file we read is the same per-oblast bundle the existing
// useSectionsVotes hook uses (`/<date>/sections/by-oblast/<NN>.json`),
// keyed by the 2-digit numeric MIR code. React Query dedupes the fetch
// across every consumer of that bundle on the same page.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { SectionInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { oblastToMir } from "@/data/parliament/nsFolders";

type SectionsByOblast = Record<string, SectionInfo>;

const fetchOblastBundle = async (
  date: string,
  numericPrefix: string,
): Promise<SectionsByOblast> => {
  const r = await fetch(
    dataUrl(`/${date}/sections/by-oblast/${numericPrefix}.json`),
  );
  if (!r.ok) throw new Error(`sections fetch failed: ${r.status}`);
  return r.json();
};

export const usePollingSectionsForEkatte = (
  oblastAlpha: string,
  ekatte: string,
): SectionInfo[] => {
  const { selected } = useElectionContext();
  const numericPrefix = oblastToMir(oblastAlpha);

  const { data } = useQuery({
    queryKey: ["sections_oblast", selected || "", numericPrefix || ""] as const,
    queryFn: () => fetchOblastBundle(selected!, numericPrefix!),
    enabled: !!selected && !!numericPrefix,
    staleTime: Infinity,
  });

  return useMemo(() => {
    if (!data) return [];
    const out: SectionInfo[] = [];
    for (const sec of Object.values(data)) {
      if (sec.ekatte === ekatte) out.push(sec);
    }
    out.sort((a, b) => a.section.localeCompare(b.section));
    return out;
  }, [data, ekatte]);
};
