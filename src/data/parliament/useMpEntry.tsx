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

// Per-MP roster shard (~0.4 KB) written by scripts/parliament/lib/writeMpById.
// Content-type guard: Vite dev (and SPA-style hosts) return index.html for a
// missing static path with a 200, so treat any non-JSON body as a miss instead
// of throwing a JSON-parse error — the caller then falls back to the full
// roster (useMps) just as it would on a real 404.
const fetchMpEntry = async (id: number): Promise<MpIndexEntry | null> => {
  const r = await fetch(dataUrl(`/parliament/by-id/${id}.json`));
  if (r.status === 404) return null;
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return hydrate((await r.json()) as MpIndexEntry);
};

/** Resolve a single MP's roster entry by id from its own shard, avoiding the
 * ~950 KB parliament/index.json download. Returns `undefined` while loading or
 * when the shard is missing (legacy deploy) — callers should fall back to the
 * full roster in that case. */
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
