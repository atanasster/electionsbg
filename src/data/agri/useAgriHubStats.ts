// The /subsidies hub's one stat call — every tile figure for one scope, from
// migration 162's matview via `/api/db/agri-hub-stats`.
//
// `scope` is the `agri_payloads` overview key ('' | <year> | 'all'), i.e. whatever
// `agriScopeToKey` resolved. `null` disables the query outright: the corpus has no
// such scope, so there is nothing to ask for and the caller renders its named empty
// state rather than sitting on a reply that will never carry data.
//
// The route returns `null` (not a 404) for an unknown scope and degrades a missing
// migration to `null` as well, so a consumer must treat `undefined` as „still
// loading" and `null` as „no figures" — a tile with no metric, never a zero.

import { useQuery } from "@tanstack/react-query";

/** One scope's figures. Every money key names its basis — see 162's header. */
export interface AgriHubStats {
  scopeKey: string;
  scopeYear: number | null;
  paymentRows: number;
  totalEur: number;
  entityCountExPayer: number;
  entityEurExPayer: number;
  noEikEur: number;
  noEikBeneficiaries: number;
  noEikRows: number;
  /** FLOOR: unmistakable legal-form markers only, so the true figure is higher. */
  noEikCompanyShapedEurFloor: number | null;
  noEikPctOfTotalEur: number | null;
  schemeCount: number;
  topScheme: string | null;
  topSchemeEur: number | null;
  oblastCount: number;
  topOblast: string | null;
  topOblastEur: number | null;
  top100PctOfEntityEur: number | null;
  top1000PctOfEntityEur: number | null;
  /** NULL, never 0, when the person layer had not been resolved when this was built. */
  politicalEiks: number | null;
  politicalEur: number | null;
  politicalPeople: number | null;
  politicalBasisBuilt: boolean;
  isunEiks: number;
  contractEiks: number;
  crossStream: {
    muniTransferEur: number | null;
    muniTransferYear: number | null;
    muniCount: number | null;
  };
}

const fetchHubStats = async (scope: string): Promise<AgriHubStats | null> => {
  const r = await fetch(
    `/api/db/agri-hub-stats?scope=${encodeURIComponent(scope)}`,
  );
  // null on ANY failure including a thrown one: a caller gating its empty state on
  // `=== null` is unreachable if a `!r.ok` path lets React Query settle undefined.
  if (!r.ok) return null;
  return (await r.json()) as AgriHubStats | null;
};

export const useAgriHubStats = (scope: string | null) =>
  useQuery({
    queryKey: ["agri", "hub-stats", scope ?? "(none)"],
    queryFn: () => fetchHubStats(scope as string),
    enabled: scope !== null,
    staleTime: Infinity,
  });
