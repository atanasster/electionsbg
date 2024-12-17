import { SectionInfo } from "../dataTypes";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | null | undefined]
>): Promise<SectionInfo | undefined> => {
  if (!queryKey[1]) {
    return undefined;
  }
  const response = await fetch(`/${queryKey[1]}/sections/${queryKey[2]}.json`);
  const data = await response.json();
  return data;
};

export const useSectionsVotes = (section?: string | null) => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["sections", selected, section],
    queryFn: queryFn,
    enabled: !!section,
  });

  return data;
};
