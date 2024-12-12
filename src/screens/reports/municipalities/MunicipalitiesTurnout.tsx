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
    `/${queryKey[1]}/reports/municipality/turnout.json`,
  );
  const data = await response.json();
  return data;
};

export const MunicipalitiesTurnout = () => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["municipality_turnout", selected],
    queryFn,
  });

  return (
    <Template
      defaultThreshold={50}
      votes={data}
      titleKey="voter_turnout"
      ruleKey="voter_turnout_over"
      visibleColumns={["voterTurnout"]}
    />
  );
};
