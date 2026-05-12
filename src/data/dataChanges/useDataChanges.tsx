import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type DataChangeLink = {
  to: string;
  labelKey: string;
};

export type DataChangeEntry = {
  timestamp: string;
  date: string;
  skill: string;
  source?: string;
  summary: string;
  links?: DataChangeLink[];
};

export type DataChangesLog = {
  updatedAt: string;
  entries: DataChangeEntry[];
};

const fetchDataChanges = async (): Promise<DataChangesLog> => {
  const res = await fetch(dataUrl("/data-changes.json"));
  if (!res.ok) return { updatedAt: new Date(0).toISOString(), entries: [] };
  return (await res.json()) as DataChangesLog;
};

export const useDataChanges = () =>
  useQuery({
    queryKey: ["data-changes"],
    queryFn: fetchDataChanges,
  });
