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
    `/${queryKey[1]}/reports/municipality/additional_voters.json`,
  );
  const data = await response.json();
  return data;
};

export const MunicipalitiesAdditionalVoters = () => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["municipality_additional_voters", selected],
    queryFn,
  });

  return (
    <Template
      defaultThreshold={5}
      votes={data}
      titleKey="additional_voters"
      ruleKey="additional_voters_over"
      visibleColumns={["pctAdditionalVoters"]}
    />
  );
};
