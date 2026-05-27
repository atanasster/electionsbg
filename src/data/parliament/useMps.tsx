import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { normalizeMpName } from "@/lib/utils";

// MP photos are stored at /parliament/photos/<id>.webp (cached locally
// from parliament.bg by the scraper, served from the bucket with our
// long immutable cache). The scraper writes the relative path into
// the index; the SPA resolves it through dataUrl so the fetch hits the
// bucket origin in production. Backwards-compat: legacy index files
// (pre-photo-caching) may still have absolute parliament.bg URLs — those
// pass through unchanged.
const resolvePhoto = (url: string): string => {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return dataUrl(url);
};

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

const queryFn = async (): Promise<IndexFile | undefined> => {
  const response = await fetch(dataUrl(`/parliament/index.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  const file = (await response.json()) as IndexFile;
  for (const mp of file.mps) {
    // Resolve photoUrl once at ingest so every consumer sees an absolute,
    // bucket-resolved URL without having to know about the dataUrl seam.
    mp.photoUrl = resolvePhoto(mp.photoUrl);
    // Re-canonicalize hyphenated names in case a legacy index was written
    // before normalizeMpName collapsed " - " → "-". Idempotent for fresh
    // indexes.
    mp.normalizedName = normalizeMpName(mp.normalizedName);
    mp.normalizedName_en = normalizeMpName(mp.normalizedName_en);
  }
  return file;
};

export const useMps = () => {
  const { data, isLoading } = useQuery({
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
      return byName.get(normalizeMpName(name));
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
    isLoading,
  };
};
