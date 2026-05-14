import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MpOwnershipStake, TrCompanyEnrichment } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

/** Subset of MpOwnershipStake actually rendered on /mp/company/{slug}.
 * The full per-MP declaration JSON keeps every field; here we ship only
 * what the company page reads — itemType / companyName / registeredOffice /
 * holderName / transfereeName are dropped to shrink the eagerly-loaded
 * companies-index.json (~10 KB brotli savings). */
export type CompanyIndexStake = Pick<
  MpOwnershipStake,
  "table" | "shareSize" | "valueEur" | "legalBasis" | "fundsOrigin"
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

/** TR-only relationship between an MP and a company — manager, partner,
 * historical role, transferred share. Populated by the post-graph extension
 * step in build_connections_graph.ts so the All Companies page can show MPs
 * connected via the Commerce Registry even when no stake was declared. */
export type CompanyMpRole = {
  mpId: number;
  mpName: string;
  /** Same vocabulary as ConnectionsEdge.role — `manager`, `partner`,
   * `tr_owner`, `procurator`, etc. */
  role: string;
  isCurrent: boolean;
  confidence: "high" | "medium";
};

export type CompanyEntry = {
  slug: string;
  displayName: string;
  registeredOffices: string[];
  stakes: CompanyStakeEntry[];
  /** TR-only relationships (no declared stake). Empty array or omitted for
   * declared-only entries. */
  mpRoles?: CompanyMpRole[];
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
  const response = await fetch(dataUrl(`/parliament/companies-index.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
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
