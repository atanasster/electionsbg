// Data hook for the rail subsidy-dependency tile on /sector/transport (Phase 3a). Joins
// two already-ingested artifacts — the state rail subsidy from the budget law
// (data/transport/rail_subsidy.json) and rail ridership from Eurostat
// (data/transport/rail_ridership.json) — into a per-year view whose headline metric is
// the PSO subsidy PER PASSENGER (the "what the state puts into every ticket" number).
// Annual, national; not scope-windowed (budget/Eurostat cadence, like the budget tile).

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

interface RailSubsidyFile {
  source: { name: string; note: string; unit: string };
  years: {
    fiscalYear: number;
    bdzPassengerPsoEur: number | null;
    nkzhiOperatingEur: number | null;
    bdzCapitalEur: number | null;
    nkzhiCapitalEur: number | null;
  }[];
}
interface RailRidershipFile {
  source: { name: string; dataset: string };
  series: {
    year: number;
    passengers: number | null;
    passengerKmMio: number | null;
  }[];
}

/** One year: the subsidy split, ridership, and the derived per-passenger figure. */
export interface RailSubsidyRow {
  year: number;
  /** PSO operating subsidy to БДЖ — Пътнически (the per-ticket subsidy). */
  pso: number | null;
  /** НКЖИ infrastructure subsidy (operating + capital). */
  nkzhi: number | null;
  /** Capital transfer to БДЖ (rolling stock etc.). */
  bdzCapital: number | null;
  /** All rail subsidy: PSO + НКЖИ + БДЖ capital. */
  total: number | null;
  passengers: number | null;
  /** PSO ÷ passengers — the €/ticket the state pays to run passenger rail. */
  perPassenger: number | null;
}

const useFile = <T,>(key: string, path: string) =>
  useQuery({
    queryKey: ["transport", key] as const,
    queryFn: async (): Promise<T | null> => {
      const r = await fetch(dataUrl(path));
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: Infinity,
  });

export const useRailSubsidy = (): {
  rows: RailSubsidyRow[];
  latest: RailSubsidyRow | null;
  isLoading: boolean;
} => {
  const subsidy = useFile<RailSubsidyFile>(
    "rail_subsidy",
    "/transport/rail_subsidy.json",
  );
  const ridership = useFile<RailRidershipFile>(
    "rail_ridership",
    "/transport/rail_ridership.json",
  );

  const rows = useMemo<RailSubsidyRow[]>(() => {
    const subs = subsidy.data?.years ?? [];
    const paxByYear = new Map<number, number | null>(
      (ridership.data?.series ?? []).map((s) => [s.year, s.passengers]),
    );
    return subs
      .map((y) => {
        const pso = y.bdzPassengerPsoEur;
        const nkzhi =
          (y.nkzhiOperatingEur ?? 0) + (y.nkzhiCapitalEur ?? 0) || null;
        const bdzCapital = y.bdzCapitalEur;
        const total = (pso ?? 0) + (nkzhi ?? 0) + (bdzCapital ?? 0) || null;
        const passengers = paxByYear.get(y.fiscalYear) ?? null;
        const perPassenger =
          pso != null && passengers && passengers > 0 ? pso / passengers : null;
        return {
          year: y.fiscalYear,
          pso,
          nkzhi,
          bdzCapital,
          total,
          passengers,
          perPassenger,
        };
      })
      .sort((a, b) => a.year - b.year);
  }, [subsidy.data, ridership.data]);

  const latest = useMemo(() => {
    const withPso = rows.filter((r) => r.pso != null);
    return withPso[withPso.length - 1] ?? null;
  }, [rows]);

  return { rows, latest, isLoading: subsidy.isLoading || ridership.isLoading };
};
