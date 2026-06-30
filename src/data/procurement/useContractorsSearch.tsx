// Lazy company-name → EIK lookup for the procurement dashboard's company
// search box. Loads the slim {eik,name} index built by
// scripts/procurement/build_contractors_search.ts. This file is ~1.8 MB raw /
// ~475 KB gz, so the fetch is GATED behind `enabled` — the search box flips it
// true only on first focus, keeping it off the global header search (most
// visitors are here for elections, not procurement) and off every procurement
// page-load that never touches the box.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { transliterateName } from "@/data/candidates/transliterateName";

export type ContractorSearchRow = { eik: string; name: string };

type ContractorsSearchFile = {
  total: number;
  entries: ContractorSearchRow[];
};

const fetchContractorsSearch =
  async (): Promise<ContractorsSearchFile | null> => {
    const r = await fetch(
      dataUrl("/procurement/derived/contractors_search.json"),
    );
    if (!r.ok) return null;
    // The dev server answers a missing file with 200 + index.html; treat a
    // non-JSON body as "no index".
    if (!(r.headers.get("content-type") || "").includes("json")) return null;
    return (await r.json()) as ContractorsSearchFile;
  };

// Normalise for substring matching: lowercase + collapse whitespace.
const norm = (s: string) =>
  s.toLocaleLowerCase("bg").replace(/\s+/g, " ").trim();

// Bilingual haystack: the Cyrillic name plus its Streamlined-System Latin
// transliteration, so a Latin-script query ("Sofarma", "Glavbolgarstroy") hits
// the 99% of company names that are Cyrillic-only. Computed client-side (like
// the officials search) so the shipped index stays {eik,name} — no extra bytes
// over the wire, just a one-time transliteration pass when the index loads.
const haystack = (name: string) =>
  `${norm(name)} ${norm(transliterateName(name))}`;

/** Lazy contractors index. `enabled` gates the network fetch — pass false until
 *  the user engages the search box. */
export const useContractorsIndex = (enabled: boolean) => {
  const { data, isLoading } = useQuery({
    queryKey: ["procurement", "contractors-search"] as const,
    queryFn: fetchContractorsSearch,
    staleTime: Infinity,
    enabled,
    retry: false,
  });
  // Precompute the bilingual haystack once so each keystroke is just indexOf
  // over a flat array rather than re-lowercasing/transliterating 26k names.
  const rows = useMemo(
    () => (data?.entries ?? []).map((e) => ({ ...e, hay: haystack(e.name) })),
    [data],
  );
  return { rows, total: data?.total ?? 0, isLoading: enabled && isLoading };
};

/** Token-AND substring search over the precomputed rows. Every whitespace-
 *  separated query token must appear somewhere in the name (order-independent),
 *  so "комнет холдинг" matches "Комнет българия холдинг ООД". Capped at `limit`
 *  — the index is value-ranked, so the cap keeps the biggest matches. */
export const filterContractors = (
  rows: Array<ContractorSearchRow & { hay: string }>,
  query: string,
  limit = 20,
): ContractorSearchRow[] => {
  const tokens = norm(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return [];
  const out: ContractorSearchRow[] = [];
  for (const r of rows) {
    if (tokens.every((tok) => r.hay.includes(tok))) {
      out.push({ eik: r.eik, name: r.name });
      if (out.length >= limit) break;
    }
  }
  return out;
};
