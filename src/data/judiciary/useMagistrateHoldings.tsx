// Companies a magistrate declared a link to (чл. 175а ЗСВ), name-matched to the
// Commerce Registry. Served from Postgres (schema 070_magistrates, loaded from
// magistrate_holdings.json): the /person tile fetches ONE magistrate by name, the
// /company tile by EIK, the search a slim roster — instead of downloading the whole
// holdings / company-index / search JSON. Sparse by design; a lead, not proof.

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "./fetchJson";
import { normName } from "./normName";

export interface MagistrateCompany {
  name: string;
  stakePct: number | null;
  /** EIK when the declared name maps to exactly one registry entity; else null. */
  eik: string | null;
  /** true when the name matches several entities (a lead we cannot pin down). */
  eikAmbiguous: boolean;
}

/** Best-effort, informational figures reproduced from the declaration — specific
 *  labelled amounts, NOT a net-worth total. All in лв. */
export interface MagistrateFinancials {
  bankCashLv: number;
  securitiesLv: number;
  realEstateCount: number;
}

export interface MagistrateHolding {
  name: string;
  position: string | null;
  court: string | null;
  companies: MagistrateCompany[];
  /** Present for records written after the financials ingest; may be absent. */
  financials?: MagistrateFinancials;
}

export interface MagistrateOverview {
  year: number;
  stats: {
    magistratesScanned: number;
    withHoldings: number;
    /** The full latest-year roster count (all magistrates, holders or not). */
    rosterTotal: number;
    totalCompanies: number;
    resolvedEik: number;
  };
  magistrates: MagistrateHolding[];
}

/** Top-N magistrates (by declared-company count) + stats → the /judiciary tile.
 *  Fetch 8 by default; the full list lives on the standalone /judiciary/magistrates
 *  browse page (the tile links there — it does not re-fetch). */
export const useMagistrateOverview = (limit: number) =>
  useQuery({
    queryKey: ["judiciary", "magistrate_overview", limit] as const,
    queryFn: () =>
      fetchJson<MagistrateOverview>(
        `/api/db/magistrate-overview?limit=${limit}`,
      ),
    staleTime: Infinity,
  });

// Magistrates who declared a given company (company page).
export interface CompanyMagistrate {
  name: string;
  position: string | null;
  court: string | null;
  company: string;
  stakePct: number | null;
}

/** Magistrates whose ИВСС declaration names the company at `eik`. Empty for the vast
 *  majority of companies — a lead, not proof. */
export const useCompanyMagistrates = (
  eik: string | undefined,
): { magistrates: CompanyMagistrate[]; year: number | null } => {
  const { data } = useQuery({
    queryKey: ["judiciary", "magistrate_by_company", eik] as const,
    queryFn: () =>
      fetchJson<{ year: number; magistrates: CompanyMagistrate[] }>(
        `/api/db/magistrate-by-company?eik=${encodeURIComponent(eik ?? "")}`,
      ),
    enabled: !!eik,
    staleTime: Infinity,
  });
  return { magistrates: data?.magistrates ?? [], year: data?.year ?? null };
};

// Slim roster for the procurement combined search (name + court + company count).
export interface MagistrateSearchRow {
  name: string;
  court: string | null;
  companies: number;
}

/** The magistrate search roster. `enabled` defers the fetch until the search box is
 *  first touched, so the page does not pay for it up front. */
export const useMagistrateSearchRoster = (
  enabled: boolean,
): MagistrateSearchRow[] => {
  const { data } = useQuery({
    queryKey: ["judiciary", "magistrate_search"] as const,
    queryFn: () =>
      fetchJson<{ year: number; roster: MagistrateSearchRow[] }>(
        "/api/db/magistrate-search",
      ),
    staleTime: Infinity,
    enabled,
  });
  return data?.roster ?? [];
};

/** The magistrate record for a person NAME, if that person is a magistrate who
 *  declared a company. Null for everyone else. Name-matched (a common name could
 *  collide), so the UI must frame it as a lead. */
export const usePersonMagistrateHoldings = (
  name: string | undefined,
): { holding: MagistrateHolding | null; year: number | null } => {
  const norm = name ? normName(name) : "";
  const { data } = useQuery({
    queryKey: ["judiciary", "magistrate_by_name", norm] as const,
    queryFn: () =>
      fetchJson<(MagistrateHolding & { year: number }) | null>(
        `/api/db/magistrate-by-name?norm=${encodeURIComponent(norm)}`,
      ),
    enabled: !!norm,
    staleTime: Infinity,
  });
  return { holding: data ?? null, year: data?.year ?? null };
};

// The "richer bridge": a politician reachable from a magistrate's DECLARED companies
// over the TR officer graph. `path.companies` runs from the magistrate's declared
// company to the politician's company; `path.people` are the bridge officers between
// them (length = companies.length − 1). degree 0 = a shared company, 1 = a shared
// officer, 2 = one more hop.
export interface MagistratePoliticianLink {
  politician: string;
  /** App route to the politician: /candidate/mp-<id> | /officials/<slug>. */
  ref: string;
  kind: "mp" | "official";
  role: string | null;
  totalEur: number | null;
  degree: number;
  path: {
    companies: { eik: string; name: string | null }[];
    people: string[];
  };
}

/** Politicians a magistrate is linked to THROUGH a declared company (ownership →
 *  shared officer → … → politician's company). Empty for almost every magistrate; a
 *  name-matched, multi-hop LEAD, never proof. Same normName key as the holdings hook. */
export const useMagistratePoliticianLinks = (
  name: string | undefined,
): MagistratePoliticianLink[] => {
  const norm = name ? normName(name) : "";
  const { data } = useQuery({
    queryKey: ["judiciary", "magistrate_politician_links", norm] as const,
    queryFn: () =>
      fetchJson<MagistratePoliticianLink[]>(
        `/api/db/magistrate-politician-links?norm=${encodeURIComponent(norm)}`,
      ),
    enabled: !!norm,
    staleTime: Infinity,
  });
  return data ?? [];
};
