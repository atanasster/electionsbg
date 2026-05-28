// Municipal council resolutions — AI-summarised digest + Phase-1 vote
// tallies. Empty until `update-council-minutes` runs (see
// scripts/council/README.md). Hook returns an empty array for any
// município until then.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type CouncilTag =
  | "financial"
  | "personnel"
  | "urban_planning"
  | "procurement"
  | "social"
  | "other";

export type CouncilTallyMethod = "named" | "open" | "secret" | "none";

export type CouncilTally = {
  for: number;
  against: number;
  abstain: number;
  method: CouncilTallyMethod;
  perCouncillor?: Array<{
    name: string;
    normKey: string;
    vote: "for" | "against" | "abstain";
  }>;
};

export type CouncilTallyResult =
  | "adopted"
  | "rejected"
  | "returned"
  | "unknown";

export type CouncilResolution = {
  id: string;
  /** Optional for back-compat with the original digest-only scaffolding. */
  date: string;
  session?: string;
  number?: string;
  title: string;
  /** Aggregate vote tally; undefined when no tally is available yet. */
  tally?: CouncilTally;
  /** Adopted / rejected / returned / unknown. Optional for back-compat. */
  result?: CouncilTallyResult;
  /** Set by the Phase-4 summary pass. */
  summary_bg?: string;
  summary_en?: string;
  tags?: CouncilTag[];
  sourceUrl: string;
};

export type CouncilMinutesFile = {
  source: string;
  indexName: string;
  tags: Record<CouncilTag, { bg: string; en: string }>;
  resolutionsByObshtina: Record<string, CouncilResolution[]>;
  meta?: Record<
    string,
    {
      name: string;
      lastIngest: string;
      protocolsIngested: number;
      resolutionCount: number;
    }
  >;
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
