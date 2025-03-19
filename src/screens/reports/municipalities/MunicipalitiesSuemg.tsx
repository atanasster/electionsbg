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
    `/${queryKey[1]}/reports/municipality/suemg.json`,
  );
  const data = await response.json();
  return data;
};

export const MunicipalitiesSuemg = () => {
  const { selected } = useElectionContext();

  const { data } = useQuery({
    queryKey: ["municipality_suemg", selected],
    queryFn,
  });
  const columns = useSuemgColumns(false);
  return (
    <Template
      defaultThreshold={0}
      votes={data}
      titleKey="flash_memory_moved"
      hiddenColumns={["party", "pctPartyVote"]}
      visibleColumns={["top_party", "bottom_party"]}
      extraColumns={columns}
    />
  );
};
