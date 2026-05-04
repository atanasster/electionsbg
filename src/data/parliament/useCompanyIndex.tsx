import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MpOwnershipStake, TrCompanyEnrichment } from "@/data/dataTypes";

/** Subset of MpOwnershipStake actually rendered on /mp/company/{slug}.
 * The full per-MP declaration JSON keeps every field; here we ship only
 * what the company page reads — itemType / companyName / registeredOffice /
 * holderName / transfereeName are dropped to shrink the eagerly-loaded
 * companies-index.json (~10 KB brotli savings). */
export type CompanyIndexStake = Pick<
  MpOwnershipStake,
  "table" | "shareSize" | "valueBgn" | "legalBasis" | "fundsOrigin"
>;

export type CompanyStakeEntry = {
  mpId: number;
  declarantName: string;
  declarationYear: number;
  fiscalYear: number | null;
  institution: string;
  sourceUrl: string;
  stake: CompanyIndexStake;
};

export type CompanyEntry = {
  slug: string;
  displayName: string;
  registeredOffices: string[];
  stakes: CompanyStakeEntry[];
  /** Phase 5 TR enrichment — present only when the company name matched a
   * row in the reconstructed Commerce Registry SQLite. */
  tr?: TrCompanyEnrichment;
};

type IndexFile = {
  generatedAt: string;
  total: number;
  companies: CompanyEntry[];
};

const queryFn = async (): Promise<IndexFile | undefined> => {
  const response = await fetch(`/parliament/companies-index.json`);
  if (!response.ok) return undefined;
  return response.json();
};

export const useCompanyIndex = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_companies_index"] as [string],
    queryFn,
    staleTime: Infinity,
  });

  const bySlug = useMemo(() => {
    const m = new Map<string, CompanyEntry>();
    if (!data) return m;
    for (const c of data.companies) m.set(c.slug, c);
    return m;
  }, [data]);

  return {
    companies: data?.companies ?? [],
    bySlug,
    isLoading,
  };
};
