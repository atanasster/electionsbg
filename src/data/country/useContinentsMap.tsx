import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

type ContinentsMap = {
  viewBox: string;
  paths: {
    key: string;
    transform: string;
    paths: string[];
  }[];
};
const queryFn = async (): Promise<ContinentsMap> => {
  const response = await fetch(dataUrl("/continents_map.json"));
  const data = await response.json();
  return data;
};

export const useContinentsMap = () => {
  const { data: continents } = useQuery({
    queryKey: ["world_map"],
    queryFn,
  });

  return {
    continents,
  };
};
