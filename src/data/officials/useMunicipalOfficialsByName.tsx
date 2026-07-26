// Name-based lookup over the global municipal-officials index, served from Postgres
// (matview municipal_officials_table, migration 102) via the municipal-officials-name-index
// route. Used by screens that have a mayor / councillor name string and need to resolve it
// to an `/officials/:slug` link. One cached fetch per session (staleTime Infinity) — the
// client builds its own name maps and matches locally, so there is no per-name round trip.
// Plan: docs/plans/persons-pg-retirement-v1.md (Tier 1.5) — replaces the static
// data/officials/municipal/search_index.json.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

// `municipality` is sourced from the matview's `institution` column, which migration 102
// leaves NULL for a listing with no declaration (many councillors never file). The route
// COALESCEs it to '', but the type is honest about the nullable source and `norm` absorbs it
// either way — a stray null here previously crashed the whole map build (and ChmiFeedScreen).
type MunicipalOfficialEntry = {
  slug: string;
  name: string;
  role: string;
  municipality: string | null;
  district?: string | null;
};

type MunicipalSearchFile = {
  entries: MunicipalOfficialEntry[];
};

const fetchIndex = async (): Promise<MunicipalSearchFile | null> => {
  try {
    const r = await fetch("/api/db/municipal-officials-name-index");
    if (!r.ok) return null;
    return (await r.json()) as MunicipalSearchFile;
  } catch {
    return null;
  }
};

// Null-safe: a null/undefined municipality (a non-filing listing) must fold to "" rather
// than throw inside .normalize() and abort the whole index build.
export const norm = (s: string | null | undefined): string =>
  (s ?? "")
    .normalize("NFC")
    .toLocaleLowerCase("bg")
    .replace(/\s+/g, " ")
    .trim();

export type MunicipalNameMaps = {
  byNameAndMuni: Map<string, MunicipalOfficialEntry>;
  byName: Map<string, MunicipalOfficialEntry>;
};

/** Build the two name-lookup maps, first-wins (the wire is pre-ordered so a namesake
 *  collision resolves to the highest-priority role — mayor before councillor). Exported for
 *  unit testing the null-municipality path. */
export const buildNameMaps = (
  entries: MunicipalOfficialEntry[],
): MunicipalNameMaps => {
  const byNameAndMuni = new Map<string, MunicipalOfficialEntry>();
  const byName = new Map<string, MunicipalOfficialEntry>();
  for (const e of entries) {
    const k = `${norm(e.name)}::${norm(e.municipality)}`;
    if (!byNameAndMuni.has(k)) byNameAndMuni.set(k, e);
    const n = norm(e.name);
    if (!byName.has(n)) byName.set(n, e);
  }
  return { byNameAndMuni, byName };
};

export const useMunicipalOfficialsByName = () => {
  // Own query key — no longer shares ["search","municipal-officials"] with
  // useSearchItems, which still fetches the static search_index.json (its migration to PG,
  // needing the build's personSlug resolution + candidate-dedup, is a separate follow-up).
  // Sharing the key would have one hook serve the other's differently-shaped payload.
  const { data } = useQuery({
    queryKey: ["municipal-officials-name-index"] as const,
    queryFn: fetchIndex,
    staleTime: Infinity,
  });

  const { byNameAndMuni, byName } = useMemo(
    () => buildNameMaps(data?.entries ?? []),
    [data],
  );

  const findOfficialByName = (
    name?: string | null,
    municipality?: string | null,
  ): MunicipalOfficialEntry | undefined => {
    if (!name) return undefined;
    if (municipality) {
      const hit = byNameAndMuni.get(`${norm(name)}::${norm(municipality)}`);
      if (hit) return hit;
    }
    return byName.get(norm(name));
  };

  return { findOfficialByName };
};
