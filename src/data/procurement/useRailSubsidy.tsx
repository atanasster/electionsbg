// Data hook for the rail subsidy-dependency tile on /sector/transport/money#subsidy
// (and the /subsidies hub's rail tile, which must show the same year). Joins
// two already-ingested artifacts — the state rail subsidy from the budget law
// (data/transport/rail_subsidy.json) and rail ridership from Eurostat
// (data/transport/rail_ridership.json) — into a per-year view whose headline metric is
// the PSO subsidy PER PASSENGER (the "what the state puts into every ticket" number).
// Annual, national; not scope-windowed (budget/Eurostat cadence, like the budget tile).

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import {
  railSubsidyRows,
  railSubsidyAnchor,
  type RailSubsidyFile,
  type RailRidershipFile,
  type RailSubsidyRow,
} from "@/lib/railSubsidy";

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

export const useRailSubsidy = (
  /** Anchor `latest` to this year when it has a per-passenger figure. */
  year?: number | null,
): {
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

  const rows = useMemo<RailSubsidyRow[]>(
    () => railSubsidyRows(subsidy.data, ridership.data),
    [subsidy.data, ridership.data],
  );

  // Anchor on the latest year that actually has a PER-PASSENGER figure, not merely a PSO
  // subsidy. The subsidy comes from the budget-law watcher and ridership from the (lagging)
  // Eurostat watcher, so a new ЗДБ routinely lands a PSO year before ridership exists for it.
  // Gating on `pso != null` would make `latest.perPassenger` null and blank the whole tile;
  // this mirrors the AI railSubsidy tool, which selects the same way.
  const latest = useMemo(() => railSubsidyAnchor(rows, year), [rows, year]);

  return { rows, latest, isLoading: subsidy.isLoading || ridership.isLoading };
};
