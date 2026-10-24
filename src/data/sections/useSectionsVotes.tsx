import { SectionInfo } from "../dataTypes";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import { dataUrl } from "@/data/dataUrl";

// Per-election section data is bundled by oblast (the leading 2 digits of
// the 9-digit section ID). One fetch covers every section in that oblast,
// then we look up the requested section in the resulting map. Navigating
// between sections in the same oblast hits the React Query cache instead
// of issuing a new HTTP request.
const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string, string]>): Promise<{
  [section: string]: SectionInfo;
}> => {
  const [, date, oblast] = queryKey;
  const response = await fetch(
    dataUrl(`/${date}/sections/by-oblast/${oblast}.json`),
  );
  return response.json();
};

/** The section plus whether its oblast shard is still in flight. `section: undefined` with
 *  `isPending: false` means the station did not exist in the selected election — codes come
 *  and go between cycles, and a page reading `!section` as "loading" spins forever on them. */
export const useSectionsVotesQuery = (section?: string | null) => {
  const { selected } = useElectionContext();
  const oblast = section?.slice(0, 2);
  const enabled = !!section && !!selected && !!oblast;
  const { data: oblastData, isPending } = useQuery({
    queryKey: ["sections_oblast", selected || "", oblast || ""],
    queryFn,
    enabled,
  });

  return {
    section: section ? oblastData?.[section] : undefined,
    // An unresolved election is still loading, not absence.
    isPending: !!section && (!enabled || isPending),
  };
};

export const useSectionsVotes = (section?: string | null) =>
  useSectionsVotesQuery(section).section;
