// Slim per-MP avatar lookup — photo + party-group short, keyed by MP id.
//
// Served from Postgres (mp_profile, migration 104) via the /api/db/mp-avatars route —
// replaces the static parliament/avatars.json (persons-pg-retirement-v1 T2.3). This exists so
// <MpAvatar> can render a face + party ring WITHOUT pulling the full ~970 KB
// parliament/index.json on pages that only surface an MP through a connection
// (/company/:eik, /awarder/:eik, /officials/:slug, political links). METADATA ONLY: the .webp
// photos stay on the bucket, and the client still builds /parliament/photos/{id}.webp for the
// default case (see resolvePhoto). The full index stays the source of truth for screens that
// genuinely browse the roster; MpAvatar falls back to it only when this can't answer.

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
  const r = await fetch("/api/db/mp-avatars");
  // Throw on a real error (500 etc.) so it stays visible + retryable — otherwise a persistent
  // failure would silently degrade EVERY avatar to the ~970 KB index fallback with no signal.
  // A missing migration is NOT an error: the route returns 200 + a null body (Array.isArray
  // guard), which becomes undefined here → <MpAvatar> falls back to the roster / initials.
  if (!r.ok) throw new Error(`mp-avatars: ${r.status} ${r.url}`);
  const body = (await r.json()) as AvatarsFile | null;
  return body && typeof body === "object" && !Array.isArray(body)
    ? body
    : undefined;
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
