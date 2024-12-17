import { useQuery } from "@tanstack/react-query";
import { RegionGeoJSON } from "../../screens/components/maps/mapTypes";

const queryFn = async (): Promise<RegionGeoJSON> => {
  const response = await fetch("/sofia_map.json");
  const data = await response.json();
  return data;
};

export const useSofiaMap = () => {
  const { data } = useQuery({
    queryKey: ["sofia_map"],
    queryFn: queryFn,
  });

  return data;
};
