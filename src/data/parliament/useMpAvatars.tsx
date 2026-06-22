// Slim per-MP avatar lookup — photo + party-group short, keyed by MP id.
//
// Reads parliament/avatars.json (~36 KB), the projection emitted by
// scripts/parliament/build_avatars.ts. This exists so <MpAvatar> can render a
// face + party ring WITHOUT pulling the full ~970 KB parliament/index.json on
// pages that only surface an MP through a connection (/company/:eik,
// /awarder/:eik, /officials/:slug, political links). The full index stays the
// source of truth for screens that genuinely browse the roster; MpAvatar falls
// back to it only when this slim projection can't answer (see MpAvatar.tsx).

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

interface AvatarsFile {
  scrapedAt: string;
  total: number;
  groups: Record<string, string | null>;
  noPhoto: number[];
  extra: Record<string, string>;
}

export interface MpAvatarInfo {
  /** Absolute (dataUrl-resolved) photo URL, or "" when the MP has no photo. */
  photoUrl: string;
  /** Raw parliament.bg group short — feed to useParliamentGroups().lookup(). */
  partyGroupShort: string | null;
}

// Mirror useMps' resolvePhoto: relative paths go through dataUrl so the fetch
// hits the bucket origin in production; absolute (legacy) URLs pass through.
const resolvePhoto = (url: string): string =>
  !url ? "" : url.startsWith("http") ? url : dataUrl(url);

const queryFn = async (): Promise<AvatarsFile | undefined> => {
  const r = await fetch(dataUrl("/parliament/avatars.json"));
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as AvatarsFile;
};

export const useMpAvatars = (enabled = true) => {
  const { data, isLoading, isFetched } = useQuery({
    queryKey: ["parliament_avatars"] as [string],
    queryFn,
    staleTime: Infinity,
    enabled,
  });

  const noPhoto = useMemo(() => new Set(data?.noPhoto ?? []), [data]);

  // Returns undefined when the id is absent from the projection (e.g. a local
  // candidate id that isn't a parliament MP, or a brand-new MP not yet built) —
  // the caller decides whether to fall back to the full roster.
  const get = useMemo(
    () =>
      (id?: number | null): MpAvatarInfo | undefined => {
        if (id == null || !data) return undefined;
        const key = String(id);
        if (!(key in data.groups)) return undefined;
        const photoUrl = noPhoto.has(id)
          ? ""
          : resolvePhoto(data.extra[key] ?? `/parliament/photos/${id}.webp`);
        return { photoUrl, partyGroupShort: data.groups[key] };
      },
    [data, noPhoto],
  );

  // `isSettled` = the avatars query has resolved one way or another (data, 404,
  // or error). Callers gate their full-roster fallback on this so they don't
  // eagerly fetch the ~970 KB index on the first render before avatars.json
  // arrives — while still falling back when avatars.json is genuinely absent.
  return { get, isLoaded: data != null, isSettled: isFetched, isLoading };
};
