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
export const resolvePhoto = (url: string): string => {
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
  /** The coalition this MP was ELECTED with, off their own parliament.bg profile. The two
   *  above come from the CURRENT-NS roster, so they are null for every former MP — this is
   *  the only party 1,443 of the 2,122 roster entries carry.
   *
   *  ONE value per person, so a CAREER badge and not per-parliament: against the
   *  roll-call-derived group for the 72 MPs who changed group it matches the last NS 12
   *  times, the first 4, both 17, and neither endpoint 27. Render it as "elected with";
   *  never as the group they sat with in a given NS, and never write it into
   *  `person_role.party`. Optional because only `mp_entry()` (105) serves it. */
  electedWith?: string | null;
  position: string | null;
  birthDate: string | null;
  nsFolders: string[];
  /** Is this MP anywhere in the roll-call corpus? Served by `mp_entry()` (105) ONLY — the
   *  roster shard and the matviews do not carry it, so it is `undefined` off that route
   *  and `rollcallCoverage` treats that as "unknown". It cannot be derived from
   *  `nsFolders`: see `rollcallCoverage.ts` for the 70-MP measurement. */
  hasRollcall?: boolean;
  isCurrent: boolean;
};

type IndexFile = {
  scrapedAt: string;
  currentNs: string;
  total: number;
  mps: MpIndexEntry[];
};

// Served from Postgres (mp_profile + mp_roster_meta, migrations 104/111) via /api/db/mp-roster
// — replaces the ~950 KB static parliament/index.json (persons-pg-retirement-v1 T2.4). The
// route returns the same IndexFile shape with RELATIVE photoUrls (resolved below), so the
// per-consumer post-processing is unchanged. A null body (a DB predating 111) → undefined,
// exactly as the old 404 path did.
const queryFn = async (): Promise<IndexFile | undefined> => {
  const response = await fetch(`/api/db/mp-roster`);
  if (!response.ok) {
    throw new Error(`mp-roster: ${response.status} ${response.url}`);
  }
  const file = (await response.json()) as IndexFile | null;
  if (!file) return undefined;
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

// `enabled` lets a caller defer the ~949 KB parliament/index.json fetch until
// it actually needs the roster (e.g. the candidate page only needs it for the
// rare mp-<id>-not-on-this-ballot fallback). Defaults true so existing callers
// are unchanged. The query key is shared, so once any enabled caller loads it,
// every other useMps() instance reads it from cache.
export const useMps = (enabled = true) => {
  const { data, isLoading } = useQuery({
    queryKey: ["parliament_index"] as [string],
    queryFn,
    staleTime: Infinity,
    enabled,
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
