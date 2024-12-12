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
  const response = await fetch(`/${queryKey[1]}/reports/section/turnout.json`);
  const data = await response.json();
  return data;
};

export const SectionsTurnout = () => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["section_turnout", selected],
    queryFn,
  });

  return (
    <Template
      defaultThreshold={70}
      votes={data}
      titleKey="voter_turnout"
      ruleKey="voter_turnout_over"
      visibleColumns={["voterTurnout"]}
    />
  );
};
