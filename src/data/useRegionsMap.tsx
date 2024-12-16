import { useQuery } from "@tanstack/react-query";
import { RegionGeoJSON } from "../screens/components/maps/mapTypes";

const queryFn = async (): Promise<RegionGeoJSON> => {
  const response = await fetch("/regions_map.json");
  const data = await response.json();
  return data;
};

export const useRegionsMap = () => {
  const { data: regions } = useQuery({
    queryKey: ["regions_map"],
    queryFn: queryFn,
  });

  return {
    regions,
  };
};
