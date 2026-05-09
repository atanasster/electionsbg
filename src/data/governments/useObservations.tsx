import { useQuery } from "@tanstack/react-query";

export type ObservationMissionType = "EAM" | "LEOM" | "EOM";

export type ElectionObservation = {
  electionDate: string;
  missionType: ObservationMissionType;
  reportUrl: string;
  summaryEn: string;
  summaryBg: string;
};

export type ObservationsPayload = {
  source: string;
  sourceUrl: string;
  observations: ElectionObservation[];
};

const fetchJson = async <T,>(path: string): Promise<T | undefined> => {
  const res = await fetch(path);
  if (!res.ok) return undefined;
  return (await res.json()) as T;
};

export const useObservations = () =>
  useQuery({
    queryKey: ["election-observations"],
    queryFn: () =>
      fetchJson<ObservationsPayload>("/election-observations.json"),
  });
