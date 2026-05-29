// Reverse lookup over data/officials/derived/councillor_signals.json for
// one official slug. Powers the CouncilActivitySection on
// OfficialProfileScreen — answers "what's this person's council voting
// record?" on the page users land on when they click a councillor's avatar
// from any votes-tile surface.
//
// One fetch (the global signals file, ~35 KB, cached forever). Skips when
// the slug isn't a councillor / doesn't appear in any votes shard.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

type SignalEntry = {
  votesCast: number;
  attendance: number;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  dissent: number | null;
  partyCanonicalId?: string;
};

type SignalsFile = {
  generatedAt: string;
  byObshtina: Record<
    string,
    {
      totalResolutions: number;
      byCouncillor: Record<string, SignalEntry>;
    }
  >;
};

const fetchSignals = async (): Promise<SignalsFile | undefined> => {
  const r = await fetch(dataUrl("/officials/derived/councillor_signals.json"));
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`councillor signals fetch failed: ${r.status}`);
  if (!(r.headers.get("content-type") ?? "").includes("json")) return undefined;
  return r.json();
};

export type CouncillorProfileData = {
  /** Officials-tier obshtina code where the councillor sits. */
  obshtina: string;
  /** Total resolutions with перCouncillor data in this município's window. */
  totalResolutions: number;
  /** Number of votes the councillor was present for. */
  votesCast: number;
  /** 0..1 — share of resolutions they appeared in. */
  attendance: number;
  /** Per-vote breakdown. */
  forCount: number;
  againstCount: number;
  abstainCount: number;
  /** 0..1 — share of votes against party mode; null when no party reference frame. */
  dissent: number | null;
  /** Canonical party id (joins to canonical_parties.json for label + colour). */
  partyCanonicalId?: string;
};

/**
 * Look up one councillor's accountability metrics by slug. Returns null
 * when the slug isn't a councillor or hasn't appeared in any ingested
 * votes shard yet. */
export const useCouncillorProfile = (
  slug: string | null | undefined,
): { data: CouncillorProfileData | null; isLoading: boolean } => {
  const { data: signals, isLoading } = useQuery({
    queryKey: ["councillor_signals"] as const,
    queryFn: fetchSignals,
    staleTime: Infinity,
  });

  const result = useMemo<CouncillorProfileData | null>(() => {
    if (!slug || !signals) return null;
    for (const [obshtina, slice] of Object.entries(signals.byObshtina)) {
      const sig = slice.byCouncillor[slug];
      if (sig) {
        return {
          obshtina,
          totalResolutions: slice.totalResolutions,
          votesCast: sig.votesCast,
          attendance: sig.attendance,
          forCount: sig.forCount,
          againstCount: sig.againstCount,
          abstainCount: sig.abstainCount,
          dissent: sig.dissent,
          partyCanonicalId: sig.partyCanonicalId,
        };
      }
    }
    return null;
  }, [slug, signals]);

  return { data: result, isLoading: slug ? isLoading : false };
};
