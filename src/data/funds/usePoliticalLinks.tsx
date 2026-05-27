// SPA hooks for the EU-funds political-economy join layer
// (data/funds/derived/political_links.json + per-EIK shards).
//
// Three access patterns, three hooks:
//   1) usePoliticalIndex() — slim leaderboard for /funds + /funds/political
//   2) usePoliticalManifest() — manifest of flagged EIKs (small) so per-EIK
//      checks can short-circuit without a 404 round-trip
//   3) usePoliticalForEik(eik) — per-EIK shard, only fetched when the manifest
//      says the EIK is flagged
//
// Each file is absent on a fresh clone before /update-funds runs — the queries
// degrade gracefully to "no data" rather than throwing.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export interface PoliticalMpLink {
  mpId: number;
  mpName: string;
  relations: Array<{
    kind: string;
    isCurrent?: boolean;
    confidence?: "high" | "medium" | "low";
    shareSize?: string;
    valueEur?: number;
    fiscalYear?: number;
    declarationYear?: number;
  }>;
}

export interface PoliticalOfficialRole {
  source: "tr" | "declaration" | string;
  trRole?: string | null;
  shareSize?: string | null;
  valueEur?: number | null;
}

export interface PoliticalOfficialLink {
  slug: string;
  name: string;
  category: string;
  tier: string;
  role: string;
  institution: string | null;
  municipality: string | null;
  confidence: "high" | "medium" | "low";
  latestDeclarationYear: number | null;
  roles: PoliticalOfficialRole[];
}

export interface PoliticalEntry {
  eik: string;
  name: string;
  orgType: string;
  contractCount: number;
  contractedEur: number;
  paidEur: number;
  mps: PoliticalMpLink[];
  officials: PoliticalOfficialLink[];
  procurementEur: number;
  procurementContractCount: number;
  debarred: boolean;
  exposureScore: number;
}

export interface PoliticalIndexFile {
  generatedAt: string;
  totals: {
    flaggedEiks: number;
    mpOnly: number;
    officialOnly: number;
    both: number;
    debarredFlagged: number;
    contractedEur: number;
    paidEur: number;
    procurementEur: number;
  };
  top: PoliticalEntry[];
  flaggedEiks: string[];
}

interface PoliticalManifestFile {
  generatedAt: string;
  flaggedEiks: string[];
}

const fetchPoliticalIndex = async (): Promise<PoliticalIndexFile | null> => {
  const r = await fetch(dataUrl("/funds/derived/political_links.json"));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as PoliticalIndexFile;
};

const fetchPoliticalManifest =
  async (): Promise<PoliticalManifestFile | null> => {
    const r = await fetch(
      dataUrl("/funds/derived/political-by-eik/index.json"),
    );
    if (r.status === 404) return null;
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return null;
    return (await r.json()) as PoliticalManifestFile;
  };

const fetchPoliticalShard = async (
  eik: string,
): Promise<PoliticalEntry | null> => {
  const r = await fetch(dataUrl(`/funds/derived/political-by-eik/${eik}.json`));
  if (r.status === 404) return null;
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return (await r.json()) as PoliticalEntry;
};

/** Slim leaderboard — top-50 flagged beneficiaries plus corpus totals. Loads
 * one ~54 KB file. Used by the /funds tile and the standalone /funds/political
 * leaderboard. */
export const usePoliticalIndex = (enabled = true) =>
  useQuery({
    queryKey: ["funds", "political_index"] as const,
    queryFn: fetchPoliticalIndex,
    staleTime: Infinity,
    enabled,
  });

/** Manifest of flagged EIKs (~5 KB). Lets `/company/{eik}` skip both the
 * shard fetch AND the index fallback for the vast majority of beneficiaries
 * that aren't flagged. */
export const usePoliticalManifest = (enabled = true) =>
  useQuery({
    queryKey: ["funds", "political_manifest"] as const,
    queryFn: fetchPoliticalManifest,
    staleTime: Infinity,
    enabled,
    retry: false,
  });

/** Per-EIK political-economy panel data. Two-phase: first the manifest
 * confirms the EIK is flagged, then the tiny per-EIK shard is fetched. Returns
 * `null` for non-flagged EIKs. */
export const usePoliticalForEik = (
  eik?: string | null,
): { entry: PoliticalEntry | null; isLoading: boolean } => {
  const manifestQuery = usePoliticalManifest(!!eik);
  const flagged = useMemo(
    () => new Set(manifestQuery.data?.flaggedEiks ?? []),
    [manifestQuery.data],
  );
  const isFlagged = !!eik && flagged.has(eik);

  const shardQuery = useQuery({
    queryKey: ["funds", "political_shard", eik ?? ""] as const,
    queryFn: () => fetchPoliticalShard(eik!),
    enabled: isFlagged,
    staleTime: Infinity,
    retry: false,
  });

  return useMemo(() => {
    if (!eik) return { entry: null, isLoading: false };
    const manifestKnown = manifestQuery.data != null || manifestQuery.isFetched;
    if (!manifestKnown) return { entry: null, isLoading: true };
    if (!isFlagged) return { entry: null, isLoading: false };
    if (shardQuery.data) return { entry: shardQuery.data, isLoading: false };
    return { entry: null, isLoading: shardQuery.isLoading };
  }, [
    eik,
    isFlagged,
    manifestQuery.data,
    manifestQuery.isFetched,
    shardQuery.data,
    shardQuery.isLoading,
  ]);
};
