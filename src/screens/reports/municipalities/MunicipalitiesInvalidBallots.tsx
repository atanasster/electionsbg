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
    `/${queryKey[1]}/reports/municipality/invalid_ballots.json`,
  );
  const data = await response.json();
  return data;
};

export const MunicipalitiesInvalidBallots = () => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["municipality_invalid_ballots", selected],
    queryFn,
  });

  return (
    <Template
      defaultThreshold={5}
      votes={data}
      titleKey="invalid_ballots"
      ruleKey="invalid_ballots_over"
      visibleColumns={["pctInvalidBallots"]}
    />
  );
};
