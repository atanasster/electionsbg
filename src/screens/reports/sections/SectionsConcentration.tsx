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
    `/${queryKey[1]}/reports/section/concentrated.json`,
  );
  const data = await response.json();
  return data;
};

export const SectionsConcentration = () => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["section_concentrated", selected],
    queryFn,
  });

  return (
    <Template
      defaultThreshold={90}
      bigger={true}
      votes={data}
      titleKey="concentrated_party_votes"
      ruleKey="one_party_votes_over"
    />
  );
};
