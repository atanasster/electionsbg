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
    `/${queryKey[1]}/reports/settlement/top_losers.json`,
  );
  const data = await response.json();
  return data;
};

export const SettlementsTopLosers = () => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["settlement_top_losers", selected],
    queryFn,
  });
  return (
    <Template
      defaultThreshold={90}
      bigger={false}
      votes={data}
      titleKey="top_losers"
      ruleKey="top_losers_under"
      visibleColumns={["prevYearChange", "prevYearVotes"]}
    />
  );
};
