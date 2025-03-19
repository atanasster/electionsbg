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
    `/${queryKey[1]}/reports/settlement/suemg_removed.json`,
  );
  const data = await response.json();
  return data;
};

export const SettlementsSuemgRemoved = () => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["settlement_suemg_removed", selected],
    queryFn,
  });
  const columns = useSuemgColumns();
  return (
    <Template
      defaultThreshold={0}
      votes={data}
      titleKey="flash_memory_removed"
      hiddenColumns={["party", "pctPartyVote"]}
      visibleColumns={["bottom_party"]}
      extraColumns={columns}
    />
  );
};
