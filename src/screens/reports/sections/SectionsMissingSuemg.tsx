import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { ReportRow } from "@/data/dataTypes";
import { Template } from "./Template";
import { useSuemgColumns } from "../common/suemgColumns";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  ReportRow[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(
    `/${queryKey[1]}/reports/section/suemg_missing_flash.json`,
  );
  const data = await response.json();
  return data;
};

export const SectionsMissingSuemg = () => {
  const { selected } = useElectionContext();

  const { data } = useQuery({
    queryKey: ["section_suemg_missing_flash", selected],
    queryFn,
  });
  const columns = useSuemgColumns();
  return (
    <Template
      defaultThreshold={0}
      votes={data}
      titleKey="missing_flash_memory"
      hiddenColumns={["party", "pctPartyVote"]}
      visibleColumns={[]}
      extraColumns={columns}
    />
  );
};
