// Municipal council resolutions — AI-summarised. Empty until
// `update-council-minutes` runs (see scripts/council/README.md). Hook
// returns an empty array for any município until then.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type CouncilTag =
  | "financial"
  | "personnel"
  | "urban_planning"
  | "procurement"
  | "social"
  | "other";

export type CouncilResolution = {
  id: string;
  date: string;
  title: string;
  summary_bg: string;
  summary_en: string;
  tags: CouncilTag[];
  sourceUrl: string;
};

export type CouncilMinutesFile = {
  source: string;
  indexName: string;
  tags: Record<CouncilTag, { bg: string; en: string }>;
  resolutionsByObshtina: Record<string, CouncilResolution[]>;
  note?: string;
};

const fetchCouncil = async (): Promise<CouncilMinutesFile> => {
  const r = await fetch(dataUrl("/council/index.json"));
  if (!r.ok) throw new Error("council fetch failed");
  return r.json();
};

export const useCouncilMinutes = (obshtina?: string | null) => {
  const { data } = useQuery({
    queryKey: ["council_minutes"],
    queryFn: fetchCouncil,
    staleTime: Infinity,
  });
  const resolutions = obshtina
    ? (data?.resolutionsByObshtina[obshtina] ?? [])
    : [];
  return { data, resolutions };
};
