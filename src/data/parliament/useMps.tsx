import { useCallback, useMemo } from "react";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";

export type MpIndexEntry = {
  id: number;
  name: string;
  normalizedName: string;
  photoUrl: string;
  currentRegion: { code: string; name: string } | null;
  currentPartyGroup: string | null;
  currentPartyGroupShort: string | null;
  position: string | null;
  birthDate: string | null;
  nsFolders: string[];
  isCurrent: boolean;
};

type IndexFile = {
  scrapedAt: string;
  currentNs: string;
  total: number;
  mps: MpIndexEntry[];
};

const normalize = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string]>): Promise<IndexFile | undefined> => {
  const response = await fetch(`/parliament/index.json`);
  if (!response.ok) return undefined;
  return response.json();
};

export const useMps = () => {
  const { data } = useQuery({
    queryKey: ["parliament_index"] as [string],
    queryFn,
    staleTime: Infinity,
  });

  const byName = useMemo(() => {
    const m = new Map<string, MpIndexEntry>();
    if (!data) return m;
    for (const mp of data.mps) m.set(mp.normalizedName, mp);
    return m;
  }, [data]);

  const findMpByName = useCallback(
    (name?: string | null): MpIndexEntry | undefined => {
      if (!name) return undefined;
      return byName.get(normalize(name));
    },
    [byName],
  );

  return { mps: data?.mps, currentNs: data?.currentNs, findMpByName };
};
