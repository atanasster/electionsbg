import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { normalizeMpName } from "@/lib/utils";
import type { MpIndexEntry } from "./useMps";

// Mirror of useMps's per-entry hydration: photoUrl is stored relative in the
// shard (`/parliament/photos/<id>.webp`) so resolve it through dataUrl, and
// re-canonicalize the normalized name forms. Keeps consumers identical whether
// the entry came from the full roster or a single shard.
const resolvePhoto = (url: string): string => {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return dataUrl(url);
};

const hydrate = (mp: MpIndexEntry): MpIndexEntry => ({
  ...mp,
  photoUrl: resolvePhoto(mp.photoUrl),
  normalizedName: normalizeMpName(mp.normalizedName),
  normalizedName_en: normalizeMpName(mp.normalizedName_en),
});

// One MP's roster entry, from the PG mp-entry route (mp_profile, migration 105) —
// replaces the per-MP data/parliament/by-id/<id>.json shard (persons-pg-retirement-v1 T2.1).
// mp_entry() returns the identical MpIndexEntry shape (photoUrl relative-or-absolute, so
// hydrate resolves it exactly as it did off the shard); an unknown id yields a null body,
// which the caller treats as a miss and falls back to the full roster (useMps).
export const fetchMpEntry = async (
  id: number,
): Promise<MpIndexEntry | null> => {
  const r = await fetch(`/api/db/mp-entry?id=${id}`);
  if (!r.ok) return null;
  // Guard a pathological non-JSON 200 (a misroute / SPA fallthrough) the same way the old
  // shard fetch did — treat it as a miss so the caller falls back to useMps rather than
  // surfacing a parse error.
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  const body = (await r.json()) as MpIndexEntry | null;
  // typeof [] === "object": the route already collapses an array result to null, but keep
  // the client self-defending so an array can never be spread into hydrate().
  if (!body || Array.isArray(body) || typeof body !== "object") return null;
  return hydrate(body);
};

/** Resolve a single MP's roster entry by id from PG, avoiding the ~950 KB
 * parliament/index.json download. Returns `undefined` while loading or when the id is
 * unknown — callers should fall back to the full roster in that case. */
export const useMpEntry = (
  id?: number | null,
): {
  entry: MpIndexEntry | undefined;
  isLoading: boolean;
  isFetched: boolean;
} => {
  const { data, isLoading, isFetched } = useQuery({
    queryKey: ["mp_entry", id ?? 0] as [string, number],
    queryFn: () => fetchMpEntry(id!),
    enabled: id != null,
    staleTime: Infinity,
    retry: false,
  });
  return { entry: data ?? undefined, isLoading, isFetched };
};
