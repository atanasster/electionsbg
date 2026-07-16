// Poverty-reduction-effect-of-social-transfers series for the social view's
// flagship outcome tiles (the before/after dumbbell + the value-for-money scatter).
// Reads the small static data/social/poverty_impact.json written by
// scripts/social/fetch_poverty_impact.ts (Eurostat ilc_li10 before vs ilc_li02
// after; a reference series, no PG round-trip — plan §11).

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type PovertyGeo = "BG" | "EU27_2020" | "RO" | "GR" | "HU" | "HR";

/** One year's before/after at-risk-of-poverty rate (%) for one geo. */
export interface PovertyPoint {
  year: number;
  /** AROP before social transfers (pensions excluded from transfers). */
  before: number;
  /** AROP after all social transfers. */
  after: number;
}

/** Latest-year summary: the poverty-reduction effect for one geo. */
export interface PovertyLatest {
  year: number;
  before: number;
  after: number;
  /** Percentage-point reduction (before − after). */
  pp: number;
  /** Relative reduction ((before − after) / before × 100). The headline metric. */
  pct: number;
}

export interface PovertyImpactPayload {
  fetchedAt: string;
  source: {
    publisher: string;
    datasets: { before: string; after: string };
    urls: { before: string; after: string };
  };
  geos: PovertyGeo[];
  latestYear: number;
  series: Record<string, PovertyPoint[]>;
  latest: Record<string, PovertyLatest>;
}

export const usePovertyImpact = () =>
  useQuery({
    queryKey: ["social", "poverty_impact"],
    queryFn: async (): Promise<PovertyImpactPayload | undefined> => {
      const res = await fetch(dataUrl("/social/poverty_impact.json"));
      if (!res.ok) return undefined;
      return (await res.json()) as PovertyImpactPayload;
    },
    staleTime: Infinity,
  });
