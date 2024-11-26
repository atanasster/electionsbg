import { useQuery } from "@tanstack/react-query";
import { SettlementGeoJSON } from "./mapTypes";

const queryFn = async (): Promise<SettlementGeoJSON> => {
  const response = await fetch("/settlements_map.json");
  const data = await response.json();
  return data;
};

export const useSettlementsMap = () => {
  const { data: settlements } = useQuery({
    queryKey: ["settlements_map"],
    queryFn: queryFn,
  });

  return {
    settlements,
  };
};
