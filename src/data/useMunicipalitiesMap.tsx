import { useQuery } from "@tanstack/react-query";
import { MunicipalityGeoJSON } from "./mapTypes";

const queryFn = async (): Promise<MunicipalityGeoJSON> => {
  const response = await fetch("/municipalities_map.json");
  const data = await response.json();
  return data;
};

export const useMunicipalitiesMap = () => {
  const { data: municipalities } = useQuery({
    queryKey: ["municipalities_map"],
    queryFn: queryFn,
  });

  return {
    municipalities,
  };
};
