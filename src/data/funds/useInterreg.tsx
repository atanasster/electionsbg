// Interreg (keep.eu / INTERACT) — the cross-border corpus ИСУН does not hold.
//
// `fund_projects` contains ZERO Interreg projects, and that is a system boundary
// rather than a filter: Interreg runs on Jems, the Bulgarian OPs on ИСУН 2020.
// Because Interreg is cross-border by definition, the money it was missing lands
// on exactly the border municipalities — which is why the per-capita ranking
// understated them until migration 139.
//
// Served LIVE from the fact tables (137), never from fund_payloads: an
// `interreg-*` kind written there would be silently deleted by the next
// db:load:funds:pg.

import { useQuery } from "@tanstack/react-query";
import type { InterregOverview, FundsMuniRank } from "./types";

const getJson = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`interreg fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as T;
};

export const useInterregOverview = () =>
  useQuery({
    queryKey: ["interreg", "overview"] as const,
    queryFn: () => getJson<InterregOverview>("/api/db/interreg-overview"),
    staleTime: Infinity,
  });

/** The per-capita municipal leaderboard with the Interreg arm counted, plus the
 *  `excluded` buckets naming what it does NOT cover — Столична община's €88.7m
 *  above all, which sits outside the cohort on both arms because ГРАО carries no
 *  Sofia city EKATTE. Rendering the table without that caveat would imply
 *  national coverage the ranking does not have. */
export const useFundsMuniRank = (limit = 25) =>
  useQuery({
    queryKey: ["funds", "muni-rank", limit] as const,
    queryFn: () =>
      getJson<FundsMuniRank>(`/api/db/funds-muni-rank?limit=${limit}`),
    staleTime: Infinity,
  });
