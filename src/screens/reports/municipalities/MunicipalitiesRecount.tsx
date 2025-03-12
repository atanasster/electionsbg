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
    `/${queryKey[1]}/reports/municipality/recount.json`,
  );
  const data = await response.json();
  return data;
};

export const MunicipalitiesRecount = () => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["municipality_recount", selected],
    queryFn,
  });

  return (
    <Template
      defaultThreshold={0}
      votes={data}
      titleKey="votes_recount"
      hiddenColumns={["party", "pctPartyVote"]}
      visibleColumns={["recount"]}
    />
  );
};
