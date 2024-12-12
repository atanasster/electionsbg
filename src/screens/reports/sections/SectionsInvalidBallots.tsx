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
    `/${queryKey[1]}/reports/section/invalid_ballots.json`,
  );
  const data = await response.json();
  return data;
};

export const SectionsInvalidBallots = () => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["section_invalid_ballots", selected],
    queryFn,
  });

  return (
    <Template
      defaultThreshold={20}
      votes={data}
      titleKey="invalid_ballots"
      ruleKey="invalid_ballots_over"
      visibleColumns={["pctInvalidBallots"]}
    />
  );
};
