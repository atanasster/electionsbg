// Fetches ONE polling station's full council party-vote breakdown for the
// per-section detail page (data/<cycle>/sections/<obshtina>/<sectionCode>.json).
//
// This is the heavy-detail tier: the município section index (useLocalSections)
// trims partyVotes to the top few to stay light for the map/table, so the
// detail page loads just this tiny per-station file (~1–2KB) instead of the
// whole shard (Sofia's was ~2MB). Returns undefined on 404.

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { LocalSectionDetail } from "./types";
import { useLatestLocalCycle } from "./useLatestLocalCycle";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string, string | null | undefined, string | null | undefined]
>): Promise<LocalSectionDetail | undefined> => {
  if (!queryKey[2] || !queryKey[3]) return undefined;
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/sections/${queryKey[2]}/${queryKey[3]}.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `local section fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

export const useLocalSection = (
  obshtinaCode?: string | null,
  sectionCode?: string | null,
  cycle?: string,
) => {
  const fallback = useLatestLocalCycle();
  const active = cycle ?? fallback;
  const { data, isLoading, error } = useQuery({
    queryKey: ["local_section", active, obshtinaCode, sectionCode],
    queryFn,
    enabled: !!obshtinaCode && !!sectionCode,
  });
  return { detail: data, isLoading, error, cycle: active };
};
