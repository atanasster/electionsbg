// SPA hooks for the EU-funds political-economy join layer
// (data/funds/derived/political_links.json + per-EIK shards).
//
// Three access patterns, three hooks:
//   1) usePoliticalIndex() — slim leaderboard for /funds + /funds/political
//
// `usePoliticalManifest` / `usePoliticalForEik` lived here too, as the per-EIK arm of
// /company/:eik's political tile. That tile now reads `/api/db/company-political`, which unions
// this shard with `company_politicians` and the person layer SERVER-side — the merge cannot be
// done in the browser, because its dedup key needs `officials_person_slug()`. Both hooks were
// left with no caller and were removed; the `political-by-eik` payload itself is still live and
// is read by that route.
//
// Each file is absent on a fresh clone before /update-funds runs — the queries
// degrade gracefully to "no data" rather than throwing.

import { useQuery } from "@tanstack/react-query";
import { fetchFundPayload } from "./fetchFundPayload";

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

const fetchPoliticalIndex = (): Promise<PoliticalIndexFile | null> =>
  fetchFundPayload<PoliticalIndexFile>("political-links");

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
