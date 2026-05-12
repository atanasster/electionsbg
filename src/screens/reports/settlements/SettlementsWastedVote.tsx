import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { ReportRow } from "@/data/dataTypes";
import { Template } from "./Template";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  ReportRow[]
> => {
  if (!queryKey[1]) return [];
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/reports/settlement/wasted_votes.json`),
  );
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const SettlementsWastedVote = () => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["settlement_wasted_votes", selected],
    queryFn,
  });

  return (
    <Template
      defaultThreshold={10}
      bigger={true}
      votes={data}
      titleKey="wasted_votes_title"
      ruleKey="wasted_votes_rule"
    />
  );
};
