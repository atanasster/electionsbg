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
    `/${queryKey[1]}/reports/section/top_gainers.json`,
  );
  const data = await response.json();
  return data;
};

export const SectionsTopGainers = () => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["section_top_gainers", selected],
    queryFn,
  });
  return (
    <Template
      defaultThreshold={90}
      votes={data}
      titleKey="top_gainers"
      ruleKey="top_gainers_over"
      visibleColumns={["prevYearChange", "prevYearVotes"]}
    />
  );
};
