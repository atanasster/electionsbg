import { useQuery } from "@tanstack/react-query";
import type { MpCarsFile } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async (): Promise<MpCarsFile | undefined> => {
  const response = await fetch(dataUrl(`/parliament/mp-cars.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
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
