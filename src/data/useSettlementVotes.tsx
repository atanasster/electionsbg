import { useCallback } from "react";
import { ElectionSettlement } from "./dataTypes";
import { useQuery } from "@tanstack/react-query";

const queryFn = async (): Promise<ElectionSettlement[]> => {
  const response = await fetch("/2024_10/settlement_votes.json");
  const data = await response.json();
  return data;
};
export const useSettlementVotes = () => {
  const { data: settlements } = useQuery({
    queryKey: ["settlement_votes"],
    queryFn,
  });
  const votesBySettlement = useCallback(
    (ekatte: string) => {
      return settlements?.find((s) => s.ekatte === ekatte);
    },
    [settlements],
  );

  return {
    votesBySettlement,
    settlements,
  };
};
