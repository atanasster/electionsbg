// Fetches the per-município section shard (council per-polling-station results
// + turnout) for a given obshtina code and cycle.
//
// Present for every regular cycle whose section CSV bundle was ingested (2011,
// 2015, 2019, 2023). Returns undefined on 404 so the tile self-hides for cycles /
// municípios without section data (e.g. Sofia район shards, whose council is
// replicated city-wide; the SOF shard carries the sections).

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { LocalSectionShard } from "./types";
import { useLatestLocalCycle } from "./useLatestLocalCycle";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string, string | null | undefined]>): Promise<
  LocalSectionShard | undefined
> => {
  if (!queryKey[2]) return undefined;
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/sections/${queryKey[2]}.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `local sections fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

export const useLocalSections = (
  obshtinaCode?: string | null,
  cycle?: string,
  // Gate the fetch. The section shard is the heaviest payload on the município
  // page (Sofia's SOF shard is ~3.9MB), so the section tile defers it until it
  // scrolls into view rather than paying it on every page load. Defaults to
  // true for callers that genuinely need it immediately.
  enabled: boolean = true,
) => {
  const fallback = useLatestLocalCycle();
  const active = cycle ?? fallback;
  const { data, isLoading, error } = useQuery({
    queryKey: ["local_sections", active, obshtinaCode],
    queryFn,
    enabled: !!obshtinaCode && enabled,
  });
  return { shard: data, isLoading, error, cycle: active };
};
