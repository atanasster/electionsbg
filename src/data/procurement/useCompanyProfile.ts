// useCompanyProfile — the reusable fetch adapter for /api/db/company (the same
// endpoint CompanyDbScreen drives). It exposes a typed SUBSET: the TR identity
// plus the headline cross-corpus signals (procurement-as-supplier, officers,
// political links, EU funds, subsidies). Lets a non-company screen (e.g. the
// retail-chain profile) surface a compact "beyond the shelf" summary + a link to
// the full /company/:eik page, without re-deriving the whole rollup.

import { useQuery } from "@tanstack/react-query";
import { decodeEntities } from "@/lib/decodeEntities";

export interface CompanyProfile {
  eik: string;
  /** TR register record; null for foreign / deregistered entities. */
  company: {
    name: string;
    seat?: string | null;
    status?: string | null;
    legal_form?: string | null;
  } | null;
  /** Procurement corpus summary (contract count as a supplier). */
  summary: { contracts?: number } | null;
  /** Supplier rollup — money won as a state contractor. */
  procurement: {
    totalEur: number;
    contractCount: number;
    awarderCount: number;
  } | null;
  officers: unknown[];
  politicians: unknown[];
  /** ИСУН EU-funds rollup, or null. */
  funds: unknown | null;
  /** ДФЗ agri-subsidy rollup, or null. */
  subsidies: unknown | null;
}

const fetchCompanyProfile = async (eik: string): Promise<CompanyProfile> => {
  const r = await fetch(`/api/db/company?eik=${encodeURIComponent(eik)}`);
  const j = (await r.json()) as CompanyProfile & { error?: string };
  if (j.error) throw new Error(j.error);
  return {
    eik,
    company: j.company
      ? { ...j.company, name: decodeEntities(j.company.name) }
      : null,
    summary: j.summary ?? null,
    procurement: j.procurement ?? null,
    officers: j.officers ?? [],
    politicians: j.politicians ?? [],
    funds: j.funds ?? null,
    subsidies: j.subsidies ?? null,
  };
};

export const useCompanyProfile = (eik?: string | null) =>
  useQuery({
    queryKey: ["company-profile", eik ?? ""],
    queryFn: () => fetchCompanyProfile(eik as string),
    enabled: !!eik,
    staleTime: Infinity,
  });
