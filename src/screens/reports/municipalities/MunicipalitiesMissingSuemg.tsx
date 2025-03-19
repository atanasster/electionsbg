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
    `/${queryKey[1]}/reports/municipality/suemg_missing_flash.json`,
  );
  const data = await response.json();
  return data;
};

export const MunicipalitiesMissingSuemg = () => {
  const { selected } = useElectionContext();
  const columns = useSuemgColumns();

  const { data } = useQuery({
    queryKey: ["municipality_suemg_missing_flash", selected],
    queryFn,
  });

  return (
    <Template
      defaultThreshold={0}
      votes={data}
      titleKey="missing_flash_memory"
      hiddenColumns={["party", "pctPartyVote"]}
      visibleColumns={["top_party"]}
      extraColumns={columns}
    />
  );
};
