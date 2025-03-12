import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { ReportRow } from "@/data/dataTypes";
import { Template } from "./Template";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  ReportRow[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(
    `/${queryKey[1]}/reports/section/recount_zero_votes.json`,
  );
  const data = await response.json();
  return data;
};

export const SectionsRecountZeroVotes = () => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["recount_zero_votes", selected],
    queryFn,
  });
  return (
    <Template
      defaultThreshold={0}
      votes={data}
      titleKey="recount_zero_votes"
      hiddenColumns={["party", "pctPartyVote", "recount_top_party"]}
      visibleColumns={["recount"]}
    />
  );
};
