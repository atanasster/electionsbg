// SPA hook: look up one company's connections to people in power by EIK.
//
// Reads the per-EIK file parliament/company-connections/{eik}.json — built by
// scripts/declarations/tr/build_company_connections.ts from the Commerce
// Registry. A 404 yields `null`: the company has no political connection on
// record (no officer holds public office, and none is one company-hop away).

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type ConnTier = "national" | "executive" | "municipal";

/** A politician (MP or official) reached from a company. */
export type ConnPowerRef = {
  kind: "mp" | "official";
  refId: string; // mpId (string) or official slug — deep-link target
  name: string;
  party: string | null;
  tier: ConnTier;
  roleLabel: string | null; // institution / role · municipality, for officials
};

export type ConnConfidence = "medium" | "low";

/** An officer of this company who personally holds public office. */
export type ConnDirectLink = {
  officerName: string;
  officerRole: string;
  isCurrent: boolean;
  confidence: ConnConfidence;
  power: ConnPowerRef;
};

/** company → officer → other company → a politician there. */
export type ConnBridgedLink = {
  bridgeName: string;
  bridgeRole: string;
  bridgeIsCurrent: boolean;
  viaEik: string;
  viaCompany: string | null;
  powerRole: string;
  confidence: ConnConfidence;
  power: ConnPowerRef;
};

export type CompanyConnections = {
  eik: string;
  name: string | null;
  generatedAt: string;
  officers: Array<{ name: string; role: string; isCurrent: boolean }>;
  directLinks: ConnDirectLink[];
  bridgedLinks: ConnBridgedLink[];
  truncated: boolean;
};

const fetchConnections = async (
  eik: string,
): Promise<CompanyConnections | null> => {
  const r = await fetch(dataUrl(`/parliament/company-connections/${eik}.json`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  // The dev server's SPA fallback answers a missing file with 200 + index.html
  // instead of 404 — treat a non-JSON body as "no connections".
  if (!(r.headers.get("content-type") || "").includes("json")) return null;
  return (await r.json()) as CompanyConnections;
};

/** Commerce-Registry connections for one EIK, or `null` when the company has
 * no link to a person in power. `isLoading` is false once the lookup settles. */
export const useCompanyConnections = (
  eik?: string | null,
): { connections: CompanyConnections | null; isLoading: boolean } => {
  const valid = !!eik && /^\d+$/.test(eik);
  const q = useQuery({
    queryKey: ["company-connections", eik] as const,
    queryFn: () => fetchConnections(eik as string),
    enabled: valid,
    staleTime: Infinity,
  });
  return useMemo(
    () => ({ connections: q.data ?? null, isLoading: valid && q.isLoading }),
    [q.data, q.isLoading, valid],
  );
};
