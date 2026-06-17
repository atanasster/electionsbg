import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCandidates } from "@/data/preferences/useCandidates";
import { useMps } from "@/data/parliament/useMps";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useElectionContext } from "@/data/ElectionContext";
import { dataUrl } from "@/data/dataUrl";
import { parseSlug, type ParsedSlug } from "./candidateSlug";
import {
  buildGroups,
  buildMpsByName,
  partyHintTokens,
  type ResolvedCandidate,
} from "./resolveCore";

export type { ResolvedCandidate } from "./resolveCore";

/** All resolved (name, partyNum) candidate buckets for the current election —
 * the exact grouping the candidate page uses (one bucket per distinct person,
 * each with its unambiguous `slug`). Exposed for the header search so a dropdown
 * entry can link straight to a person's slug (no namesake chooser) and show
 * their party. Returns null while the candidate roster is still loading. */
export const useCikGroups = (): ResolvedCandidate[] | null => {
  const { candidates } = useCandidates();
  const { mps } = useMps();
  const { findParty } = usePartyInfo();
  const mpsByName = useMemo(() => buildMpsByName(mps), [mps]);
  const hintsFor = useMemo(() => {
    return (partyNum: number): string[] => {
      const party = findParty(partyNum);
      if (!party) return [];
      return partyHintTokens(
        party.nickName ?? party.name ?? null,
        party.commonName,
        party.name,
      );
    };
  }, [findParty]);
  return useMemo(
    () => (candidates ? buildGroups(candidates, mpsByName, hintsFor) : null),
    [candidates, mpsByName, hintsFor],
  );
};

export type ResolveResult = {
  isLoading: boolean;
  matches: ResolvedCandidate[];
  /** Convenience: matches[0] when matches.length === 1. */
  canonical: ResolvedCandidate | null;
  /** The parsed shape of the input, for callers that want to know whether
   * the URL was a slug or a bare name. */
  parsed: ParsedSlug | null;
};

// MP photos are written into the index/shards as a relative path
// (`/parliament/photos/<id>.webp`); resolve through dataUrl so the fetch hits
// the bucket origin in production. Mirror of the same step in useMps.
const resolvePhoto = (url: string): string => {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return dataUrl(url);
};

/** Apply photoUrl resolution to a fetched record's mpEntry so consumers see
 * an absolute, bucket-resolved URL (the shard stores the raw relative path). */
const hydrate = (r: ResolvedCandidate): ResolvedCandidate =>
  r.mpEntry && r.mpEntry.photoUrl
    ? {
        ...r,
        mpEntry: { ...r.mpEntry, photoUrl: resolvePhoto(r.mpEntry.photoUrl) },
      }
    : r;

const shardKey = (parsed: ParsedSlug): string => {
  switch (parsed.kind) {
    case "mp":
      return `mp:${parsed.mpId}`;
    case "cik":
      return `cik:${parsed.partyNum}:${parsed.nameSlug}`;
    default:
      return `name:${parsed.name}`;
  }
};

const fetchResolved = async (
  election: string,
  parsed: ParsedSlug,
): Promise<ResolvedCandidate[]> => {
  // Precomputed per-candidate resolution shards (see
  // scripts/preferences/save_candidate_resolved.ts) let the candidate page
  // resolve one person without downloading the whole election candidates.json
  // (~1 MB) + parliament/index.json (~950 KB). Slug URLs hit a single by-slug
  // record; bare-name URLs hit the namesake array.
  const url =
    parsed.kind === "mp"
      ? dataUrl(`/${election}/candidates/by-slug/mp-${parsed.mpId}.json`)
      : parsed.kind === "cik"
        ? dataUrl(
            `/${election}/candidates/by-slug/c-${parsed.partyNum}-${parsed.nameSlug}.json`,
          )
        : dataUrl(
            `/${election}/candidates/${encodeURIComponent(parsed.name)}/resolved.json`,
          );
  const res = await fetch(url);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.url}`);
  const data = (await res.json()) as ResolvedCandidate | ResolvedCandidate[];
  const arr = Array.isArray(data) ? data : [data];
  return arr.map(hydrate);
};

export const useResolvedCandidate = (
  idParam: string | undefined | null,
): ResolveResult => {
  const { selected } = useElectionContext();
  const parsed = useMemo(() => parseSlug(idParam), [idParam]);

  const { data, isPending, isFetching } = useQuery({
    queryKey: [
      "candidate_resolved",
      selected,
      parsed ? shardKey(parsed) : "none",
    ],
    queryFn: () =>
      parsed
        ? fetchResolved(selected, parsed)
        : Promise.resolve([] as ResolvedCandidate[]),
    enabled: !!parsed && !!selected,
    staleTime: Infinity,
  });

  return useMemo<ResolveResult>(() => {
    if (!parsed) {
      return { isLoading: false, matches: [], canonical: null, parsed: null };
    }
    if (data === undefined) {
      // No data yet — loading unless the query is disabled for lack of an
      // election (which shouldn't happen on a real route).
      return {
        isLoading: isPending && isFetching,
        matches: [],
        canonical: null,
        parsed,
      };
    }
    // Dedup by slug (a bare name can map to the same person twice — e.g. the
    // same MP appearing under two party lists in the same cycle).
    const seen = new Set<string>();
    const unique: ResolvedCandidate[] = [];
    for (const m of data) {
      if (seen.has(m.slug)) continue;
      seen.add(m.slug);
      unique.push(m);
    }
    return {
      isLoading: false,
      matches: unique,
      canonical: unique.length === 1 ? unique[0] : null,
      parsed,
    };
  }, [parsed, data, isPending, isFetching]);
};

/** Convenience for sub-route screens (regions / sections / donations / etc.)
 * — they only need the canonical display name, not the full record. Returns
 * the resolved name when the URL is unambiguous; null while loading or when
 * we can't pick a single candidate (caller should fall back to the bare
 * URL param so the page still renders something for legacy links). */
export const useResolvedCandidateName = (
  idParam: string | undefined | null,
): {
  name: string | null;
  name_en: string | null;
  isLoading: boolean;
  ambiguous: boolean;
} => {
  const { isLoading, canonical, matches } = useResolvedCandidate(idParam);
  return {
    isLoading,
    name: canonical?.name ?? null,
    name_en: canonical?.name_en ?? null,
    ambiguous: matches.length > 1,
  };
};
