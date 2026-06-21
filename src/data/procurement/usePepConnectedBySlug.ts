// Per-official procurement lookup — the forward sibling of usePepConnectedByEik
// (which is keyed by contractor EIK). Two-phase loader: a small manifest
// (pep-by-slug/index.json) lists every official slug with at least one
// procurement-winning company; the per-slug shard carries that official's
// connected contractors. For officials with no procurement tie the manifest
// answers "no" and no shard fetch fires. Powers the procurement section on the
// /officials/<slug> profile.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { ProcurementPepConnectedEntry } from "@/data/dataTypes";

interface BySlugManifest {
  slugs: string[];
}
interface BySlugShard {
  slug: string;
  entries: ProcurementPepConnectedEntry[];
}

const fetchManifest = async (): Promise<BySlugManifest | null> => {
  const r = await fetch(dataUrl("/procurement/derived/pep-by-slug/index.json"));
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return (await r.json()) as BySlugManifest;
};

const fetchShard = async (slug: string): Promise<BySlugShard | null> => {
  const r = await fetch(
    dataUrl(`/procurement/derived/pep-by-slug/${slug}.json`),
  );
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return (await r.json()) as BySlugShard;
};

export interface PepConnectedSummary {
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  contractorCount: number;
}

/** The procurement-winning contractors tied to one official (resolved by slug),
 *  with a summary rollup. Renders-nothing-friendly: returns `entries: []` when
 *  the official has no procurement linkage or the data files are absent. */
export const usePepConnectedBySlug = (
  slug?: string | null,
): {
  entries: ProcurementPepConnectedEntry[];
  summary: PepConnectedSummary;
  isLoading: boolean;
} => {
  const manifestQuery = useQuery({
    queryKey: ["procurement", "pep_connected_by_slug_manifest"] as const,
    queryFn: fetchManifest,
    staleTime: Infinity,
    enabled: !!slug,
    retry: false,
  });
  const flagged = useMemo(
    () => new Set(manifestQuery.data?.slugs ?? []),
    [manifestQuery.data],
  );
  const isFlagged = !!slug && flagged.has(slug);

  const shardQuery = useQuery({
    queryKey: [
      "procurement",
      "pep_connected_by_slug_shard",
      slug ?? "",
    ] as const,
    queryFn: () => fetchShard(slug!),
    enabled: isFlagged,
    staleTime: Infinity,
    retry: false,
  });

  return useMemo(() => {
    const empty: PepConnectedSummary = {
      totalEur: 0,
      totalOther: {},
      contractCount: 0,
      contractorCount: 0,
    };
    if (!slug) return { entries: [], summary: empty, isLoading: false };
    const manifestKnown = manifestQuery.data != null || manifestQuery.isFetched;
    if (!manifestKnown) return { entries: [], summary: empty, isLoading: true };
    if (!isFlagged) return { entries: [], summary: empty, isLoading: false };
    if (!shardQuery.data)
      return { entries: [], summary: empty, isLoading: shardQuery.isLoading };

    const entries = shardQuery.data.entries;
    const summary: PepConnectedSummary = {
      totalEur: 0,
      totalOther: {},
      contractCount: 0,
      contractorCount: entries.length,
    };
    for (const e of entries) {
      summary.totalEur += e.totalEur;
      summary.contractCount += e.contractCount;
      for (const [cur, amt] of Object.entries(e.totalOther)) {
        summary.totalOther[cur] = (summary.totalOther[cur] ?? 0) + amt;
      }
    }
    return { entries, summary, isLoading: false };
  }, [
    slug,
    isFlagged,
    manifestQuery.data,
    manifestQuery.isFetched,
    shardQuery.data,
    shardQuery.isLoading,
  ]);
};
