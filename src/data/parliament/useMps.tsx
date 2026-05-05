import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

export type MpIndexEntry = {
  id: number;
  name: string;
  // Title-cased English form sourced from parliament.bg's EN profile API,
  // falling back to a Streamlined-System transliteration of `name` when the
  // EN profile is missing. Always populated.
  name_en: string;
  normalizedName: string;
  // Upper-case English form for case-insensitive lookups in the EN locale.
  normalizedName_en: string;
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

const queryFn = async (): Promise<IndexFile | undefined> => {
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

  const byId = useMemo(() => {
    const m = new Map<number, MpIndexEntry>();
    if (!data) return m;
    for (const mp of data.mps) m.set(mp.id, mp);
    return m;
  }, [data]);

  const findMpByName = useCallback(
    (name?: string | null): MpIndexEntry | undefined => {
      if (!name) return undefined;
      return byName.get(normalize(name));
    },
    [byName],
  );

  const findMpById = useCallback(
    (id?: number | null): MpIndexEntry | undefined =>
      id == null ? undefined : byId.get(id),
    [byId],
  );

  // MPs whose nsFolders includes the given folder AND whose currentRegion
  // matches the given region code. For the currently sitting NS this is
  // exact; for older NSes it's a heuristic (the MP's region as parliament.bg
  // last recorded it). See SKILL.md for details on the limitation.
  const findMpsByRegion = useCallback(
    (regionCode?: string | null, nsFolder?: string | null): MpIndexEntry[] => {
      if (!data?.mps || !regionCode || !nsFolder) return [];
      const code = regionCode.padStart(2, "0");
      return data.mps.filter(
        (m) => m.currentRegion?.code === code && m.nsFolders.includes(nsFolder),
      );
    },
    [data],
  );

  return {
    mps: data?.mps,
    currentNs: data?.currentNs,
    findMpByName,
    findMpById,
    findMpsByRegion,
  };
};
