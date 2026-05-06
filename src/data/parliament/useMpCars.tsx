import { useQuery } from "@tanstack/react-query";
import type { MpCarsFile } from "@/data/dataTypes";

const queryFn = async (): Promise<MpCarsFile | undefined> => {
  const response = await fetch(`/parliament/mp-cars.json`);
  if (!response.ok) return undefined;
  return response.json();
};

export const useMpCars = (options?: { enabled?: boolean }) => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_cars"] as [string],
    queryFn,
    staleTime: Infinity,
    enabled: options?.enabled ?? true,
  });
  return { mpCars: data, isLoading };
};
