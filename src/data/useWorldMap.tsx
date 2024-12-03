import { useQuery } from "@tanstack/react-query";
import { RegionGeoJSON } from "./mapTypes";

const queryFn = async (): Promise<RegionGeoJSON> => {
  const response = await fetch("/world_map.json");
  const data = await response.json();
  return data;
};

export const useWorldMap = () => {
  const { data: continents } = useQuery({
    queryKey: ["world_map"],
    queryFn,
  });

  return {
    continents,
  };
};
