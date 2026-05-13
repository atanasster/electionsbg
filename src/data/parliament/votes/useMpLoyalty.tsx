import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { useMpProfile } from "./useMpProfile";
import type { LoyaltyEntry, LoyaltyFile, LoyaltySlice } from "./types";

const queryFn = async (): Promise<LoyaltyFile | undefined> => {
  const response = await fetch(
    dataUrl(`/parliament/votes/derived/loyalty.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

// Strict: return data only for the requested NS. Older elections (pre-roll-
// call cycles) have no slice — falling back to a different NS would paint the
// wrong people (parliament.bg recycles ids across NSes) and the wrong party
// affiliations.
const pickSlice = (
  file: LoyaltyFile | undefined,
  ns: string | null,
): LoyaltySlice | undefined => {
  if (!ns) return undefined;
  return file?.byNs?.[ns];
};

// Loyalty file is one slice per NS (~50 KB each). We fetch once and select
// the slice matching the currently-selected election.
//
// Two-step MP lookup: pass the deduped roster id as `mpId` and the canonical
// name as `name`. The slice is keyed by parliament.bg's per-NS CSV id, which
// usually but not always matches the roster id (parliament.bg recycles ids
// across parliaments). If the roster-id lookup misses, we fall back to
// resolving the CSV id via the latest session's `mpNames` map keyed on the
// supplied name. Without this two-step path, the candidate-votes page would
// silently render "no roll-call record" for any MP whose roster id is from a
// different NS than the one selected.
export const useMpLoyalty = (mpId?: number | null, name?: string | null) => {
  const { selected } = useElectionContext();
  const { data, isLoading } = useQuery({
    queryKey: ["rollcall_loyalty"] as [string],
    queryFn,
    staleTime: Infinity,
  });

  const ns = electionToNsFolder(selected);
  const slice = pickSlice(data, ns);

  const { mpNames } = useMpProfile();

  const byMpId = useMemo(() => {
    const m = new Map<number, LoyaltyEntry>();
    for (const e of slice?.entries ?? []) m.set(e.mpId, e);
    return m;
  }, [slice]);

  // CSV id resolved from the per-NS mpNames map (embedded in the rollcall
  // index) keyed on the given name. Only used as a fallback when the supplied
  // mpId doesn't appear in the loyalty slice.
  const fallbackCsvId = useMemo(() => {
    if (!name) return null;
    const target = name.toLocaleLowerCase("bg");
    for (const [idStr, mpName] of Object.entries(mpNames)) {
      if (mpName.toLocaleLowerCase("bg") === target) {
        const n = Number(idStr);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  }, [name, mpNames]);

  const entry =
    (mpId != null ? byMpId.get(mpId) : undefined) ??
    (fallbackCsvId != null ? byMpId.get(fallbackCsvId) : undefined);

  return {
    file: slice,
    slice,
    ns,
    entries: slice?.entries ?? [],
    entry,
    byMpId,
    isLoading,
  };
};
