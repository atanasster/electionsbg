// Per-official lookup hooks. Two flavours:
//
//   useOfficial(slug)
//     → the index entry (name, role, institution) for one official, derived
//       from the already-cached officials assets-rankings file. Cheap;
//       no network call beyond the rankings fetch which most pages already
//       trigger.
//
//   useOfficialDeclarations(slug)
//     → the full declarations timeline for one official, lazy-fetched as a
//       per-slug JSON file. Useful for the profile page that lists every
//       year's filing, plus their nested asset / income / ownership tables.

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type {
  OfficialAssetsRankingEntry,
  OfficialDeclaration,
} from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";
import { useOfficialsRankings } from "./useOfficialsRankings";
import { byRecency } from "@/lib/declarations";

/** Returns the rankings entry for a single official slug. The rankings file
 *  is the easiest source for the SPA — it already carries name, role,
 *  institution, and latest declared net worth in one place. Returns null
 *  until the file loads or when the slug is unknown. */
export const useOfficial = (
  slug?: string | null,
): {
  official: OfficialAssetsRankingEntry | null;
  isLoading: boolean;
} => {
  const { rankings, isLoading } = useOfficialsRankings();
  const official = useMemo(() => {
    if (!slug || !rankings) return null;
    return rankings.topOfficials.find((o) => o.slug === slug) ?? null;
  }, [slug, rankings]);
  return { official, isLoading };
};

// Executive and municipal officials live in separate per-slug declaration
// trees. Slugs are name+institution hashed so they do not collide across
// tiers — try the executive path first, then the municipal one.
const DECLARATION_BASES = [
  "/officials/declarations",
  "/officials/municipal/declarations",
];

const fetchDeclarations = async (
  slug: string,
): Promise<OfficialDeclaration[] | null> => {
  for (const base of DECLARATION_BASES) {
    const response = await fetch(dataUrl(`${base}/${slug}.json`));
    if (!response.ok) continue;
    // A missing data file 404s on the GCS bucket but falls through to the
    // SPA's index.html (200, text/html) under the Vite dev server — treat a
    // non-JSON response as a miss and try the next tier.
    if (!(response.headers.get("content-type") ?? "").includes("json")) {
      continue;
    }
    return (await response.json()) as OfficialDeclaration[];
  }
  return null;
};

/** Returns the declarations timeline for one official (newest first). Each
 *  declaration carries the full asset / income / ownership-stake tables, so
 *  the profile page doesn't need a second fetch to render the breakdowns. */
export const useOfficialDeclarations = (
  slug?: string | null,
): { declarations: OfficialDeclaration[]; isLoading: boolean } => {
  const { data, isLoading } = useQuery({
    queryKey: ["official_declarations", slug] as const,
    queryFn: () => fetchDeclarations(slug as string),
    enabled: !!slug,
    staleTime: Infinity,
  });
  return {
    declarations: data ?? [],
    isLoading: slug ? isLoading : false,
  };
};

/** One person's filings across EVERY official identity they hold, newest first.
 *
 *  An officials slug is `name + institution` hashed, so the same person gets a
 *  NEW slug each time they change post — a deputy minister who later runs an
 *  agency has two, and 112 people in the roster hold more than one (123 extra
 *  slugs in all). The person page used to pick one arbitrarily with `.find()`,
 *  which silently hid the other post's entire declaration history and made
 *  which one you saw depend on role ordering.
 *
 *  Merging them is the honest answer: it is one person and one wealth timeline,
 *  recorded under several administrative keys. Deduped by `sourceUrl` — a
 *  filing that somehow appears under two slugs is still one filing.
 *
 *  Tier 2 replaces this with a single person_id-keyed query once the
 *  declarations live in Postgres. */
export const mergeDeclarationTimelines = (
  lists: readonly (readonly OfficialDeclaration[] | null | undefined)[],
): OfficialDeclaration[] => {
  const bySourceUrl = new Map<string, OfficialDeclaration>();
  for (const list of lists) {
    for (const d of list ?? []) {
      if (!bySourceUrl.has(d.sourceUrl)) bySourceUrl.set(d.sourceUrl, d);
    }
  }
  return [...bySourceUrl.values()].sort(byRecency);
};

export const useOfficialDeclarationsForSlugs = (
  slugs: readonly string[],
): { declarations: OfficialDeclaration[]; isLoading: boolean } => {
  // `combine` is React Query's own hook for this: it runs on the query results
  // and memoises on them, so there is no hand-rolled dependency projection to
  // get wrong (and no eslint-disable riding on an internal invariant about when
  // `dataUpdatedAt` changes).
  return useQueries({
    queries: slugs.map((slug) => ({
      queryKey: ["official_declarations", slug] as const,
      queryFn: () => fetchDeclarations(slug),
      staleTime: Infinity,
    })),
    combine: (results) => ({
      declarations: mergeDeclarationTimelines(results.map((r) => r.data)),
      isLoading: results.some((r) => r.isLoading),
    }),
  });
};
