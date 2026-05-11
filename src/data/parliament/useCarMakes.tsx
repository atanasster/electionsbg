import { useQuery } from "@tanstack/react-query";
import type { CarMakesFile } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async (): Promise<CarMakesFile | undefined> => {
  const response = await fetch(dataUrl(`/parliament/car-makes.json`));
  if (!response.ok) return undefined;
  return response.json();
};

export const useCarMakes = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_car_makes"] as [string],
    queryFn,
    staleTime: Infinity,
  });
  return { carMakes: data, isLoading };
};
