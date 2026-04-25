import { SectionInfo } from "../dataTypes";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";

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
  const response = await fetch(`/${date}/sections/by-oblast/${oblast}.json`);
  return response.json();
};

export const useSectionsVotes = (section?: string | null) => {
  const { selected } = useElectionContext();
  const oblast = section?.slice(0, 2);
  const { data: oblastData } = useQuery({
    queryKey: ["sections_oblast", selected || "", oblast || ""],
    queryFn,
    enabled: !!section && !!selected && !!oblast,
  });

  return section ? oblastData?.[section] : undefined;
};
