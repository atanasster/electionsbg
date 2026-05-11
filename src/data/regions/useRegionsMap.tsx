import { useQuery } from "@tanstack/react-query";
import { RegionGeoJSON } from "../../screens/components/maps/mapTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async (): Promise<RegionGeoJSON> => {
  const response = await fetch(dataUrl("/regions_map.json"));
  const data = await response.json();
  return data;
};

export const useRegionsMap = () => {
  const { data } = useQuery({
    queryKey: ["regions_map"],
    queryFn: queryFn,
  });

  return data;
};
