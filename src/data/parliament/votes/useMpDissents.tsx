import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { useMpProfile } from "./useMpProfile";
import { useMpShard } from "./useMpShard";
import type { DissentEntry, DissentFile, DissentSlice } from "./types";

const queryFn = async (): Promise<DissentFile | undefined> => {
  const response = await fetch(
    dataUrl(`/parliament/votes/derived/dissents.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

const pickSlice = (
  file: DissentFile | undefined,
  ns: string | null,
): DissentSlice | undefined => {
  if (!ns) return undefined;
  return file?.byNs?.[ns];
};

// Same two-step MP lookup as useMpLoyalty: prefer roster id, fall back to
// the CSV id resolved by name via the per-NS mpNames embedded in the
// rollcall index.
export const useMpDissents = (mpId?: number | null, name?: string | null) => {
  const { selected } = useElectionContext();

  // Fast-path: shard hit avoids the ~1.3 MB dissents aggregate fetch.
  const { shard, isLoading: shardLoading } = useMpShard(
    mpId ?? undefined,
    name ?? undefined,
  );

  const aggregateEnabled = !mpId && !name ? true : !shard && !shardLoading;
  const { data, isLoading: aggregateLoading } = useQuery({
    queryKey: ["rollcall_dissents"] as [string],
    queryFn,
    staleTime: Infinity,
    enabled: aggregateEnabled,
  });

  const ns = electionToNsFolder(selected);
  const slice = pickSlice(data, ns);

  const { mpNames } = useMpProfile();

  const byMpId = useMemo(() => {
    const m = new Map<number, DissentEntry>();
    for (const e of slice?.entries ?? []) m.set(e.mpId, e);
    return m;
  }, [slice]);

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

  const shardEntry: DissentEntry | undefined = shard
    ? {
        mpId: shard.mpId,
        partyShort: shard.partyShort,
        totalCast: shard.dissents.totalCast,
        dissentCount: shard.dissents.dissentCount,
        recent: shard.dissents.recent,
      }
    : undefined;

  const aggregateEntry =
    (mpId != null ? byMpId.get(mpId) : undefined) ??
    (fallbackCsvId != null ? byMpId.get(fallbackCsvId) : undefined);

  const entry = shardEntry ?? aggregateEntry;

  return {
    entry,
    slice,
    isLoading: aggregateEnabled ? aggregateLoading : false,
  };
};
