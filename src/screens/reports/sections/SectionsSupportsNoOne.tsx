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
    `/${queryKey[1]}/reports/section/supports_noone.json`,
  );
  const data = await response.json();
  return data;
};

export const SectionsSupportsNoOne = () => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["section_supports_noone", selected],
    queryFn,
  });

  return (
    <Template
      defaultThreshold={10}
      votes={data}
      titleKey="support_no_one"
      ruleKey="support_no_one_over"
      visibleColumns={["pctSupportsNoOne"]}
    />
  );
};
