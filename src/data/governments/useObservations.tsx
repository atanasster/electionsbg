import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type ObservationMissionType = "EAM" | "LEOM" | "EOM";

export type ElectionObservation = {
  electionDate: string;
  missionType: ObservationMissionType;
  reportUrl: string;
  summaryEn: string;
  summaryBg: string;
  longSummaryEn?: string;
  longSummaryBg?: string;
};

export type ObservationsPayload = {
  source: string;
  sourceUrl: string;
  observations: ElectionObservation[];
};

const fetchJson = async <T,>(path: string): Promise<T | undefined> => {
  const res = await fetch(dataUrl(path));
  if (!res.ok) return undefined;
  return (await res.json()) as T;
};

export const useObservations = () =>
  useQuery({
    queryKey: ["election-observations"],
    queryFn: () =>
      fetchJson<ObservationsPayload>("/election-observations.json"),
  });
