import { useQuery } from "@tanstack/react-query";
import type { CarMakeEntry } from "@/data/dataTypes";

/** Top car makes (distinct MPs per make) from the PG car-makes route — replaces the whole
 *  data/parliament/car-makes.json (persons-pg-retirement-v1 T2.2). Scoped to an ns bucket
 *  ("52" | "all"); pass `mpIds` (via toScopedMpIds) to restrict to a region/party set — null
 *  is unscoped (the whole ns), the [-1] sentinel yields zero makes. The route counts DISTINCT
 *  MPs per make, so a rebuild in the browser is unnecessary.
 *
 *  NOTE this replaces both the old useCarMakes (car-makes.json) AND the client-side rollup the
 *  tiles did over useMpCars (mp-cars.json) for the region/party case. */
export const useCarMakesAgg = (opts: {
  ns: string;
  mpIds?: number[] | null;
  enabled?: boolean;
}): { makes: CarMakeEntry[]; isLoading: boolean } => {
  const { ns, mpIds, enabled = true } = opts;
  const { data, isLoading } = useQuery({
    queryKey: [
      "car_makes_agg",
      ns,
      mpIds ? [...mpIds].sort((a, b) => a - b) : null,
    ] as const,
    queryFn: async (): Promise<CarMakeEntry[]> => {
      const params = new URLSearchParams({ ns });
      // A non-null mpIds (including the [-1] empty-scope sentinel) is sent; null → unscoped.
      if (mpIds) params.set("mpIds", mpIds.join(","));
      const r = await fetch(`/api/db/car-makes?${params.toString()}`);
      if (!r.ok) throw new Error(`car-makes: ${r.status} ${r.url}`);
      const body = (await r.json()) as CarMakeEntry[] | unknown;
      return Array.isArray(body) ? (body as CarMakeEntry[]) : [];
    },
    enabled,
    staleTime: Infinity,
  });
  return { makes: data ?? [], isLoading };
};
