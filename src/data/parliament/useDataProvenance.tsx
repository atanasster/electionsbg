import { useQuery } from "@tanstack/react-query";
import type { DataProvenanceFile } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async (): Promise<DataProvenanceFile | undefined> => {
  const response = await fetch(dataUrl(`/parliament/data-provenance.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useDataProvenance = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_data_provenance"] as [string],
    queryFn,
    staleTime: Infinity,
  });
  return { provenance: data, isLoading };
};
