// Name-based lookup over the global municipal-officials search index. Used
// by screens that have a mayor / councillor name string and need to resolve
// it to an `/officials/:slug` link. Shares the React Query key with the
// search-bar's own loader (`useSearchItems.tsx`), so the ~915 KB file is
// fetched once per session.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

type MunicipalOfficialEntry = {
  slug: string;
  name: string;
  role: string;
  municipality: string;
  district?: string;
};

type MunicipalSearchFile = {
  entries: MunicipalOfficialEntry[];
};

const fetchIndex = async (): Promise<MunicipalSearchFile | null> => {
  try {
    const r = await fetch(dataUrl("/officials/municipal/search_index.json"));
    if (!r.ok) return null;
    return (await r.json()) as MunicipalSearchFile;
  } catch {
    return null;
  }
};

const norm = (s: string): string =>
  s.normalize("NFC").toLocaleLowerCase("bg").replace(/\s+/g, " ").trim();

export const useMunicipalOfficialsByName = () => {
  const { data } = useQuery({
    queryKey: ["search", "municipal-officials"] as const,
    queryFn: fetchIndex,
    staleTime: Infinity,
  });

  const { byNameAndMuni, byName } = useMemo(() => {
    const byNameAndMuni = new Map<string, MunicipalOfficialEntry>();
    const byName = new Map<string, MunicipalOfficialEntry>();
    for (const e of data?.entries ?? []) {
      const k = `${norm(e.name)}::${norm(e.municipality)}`;
      if (!byNameAndMuni.has(k)) byNameAndMuni.set(k, e);
      const n = norm(e.name);
      if (!byName.has(n)) byName.set(n, e);
    }
    return { byNameAndMuni, byName };
  }, [data]);

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
