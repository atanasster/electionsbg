// Rebuild the `DailyGrid` series from Postgres.
//
// This is the seam that lets build_index.ts's 776 lines of Jevons-index maths
// port unchanged: `price_grid_days` reproduces DailyGrid.cells field for field,
// and `price_chain_grid_days` reproduces DailyGrid.chainCells. Verified cell for
// cell against the shipped _cache tree by
// scripts/db/tests/prices_grid_parity.data.test.ts.
//
// IMPORTANT: the grids come from `price_grid_days`, which the loader writes from
// each day's OWN observations. They are NOT reconstructed by expanding
// `price_facts` across the day series — a run closes only on a price change, so
// delisted SKUs leave open runs forever (36% phantom over-count after 8 days).
// See design §3.2.

import { allRows } from "../../db/lib/pg";
import type { CellAgg, DailyGrid } from "../types";

interface GridRow {
  day: string;
  ekatte: string;
  pid: number;
  min_eur: number;
  avg_eur: number;
  max_eur: number;
  median_eur: number;
  promo_min_eur: number | null;
  stores: number;
  chains: number;
  cheapest_eik: string | null;
  cheapest_store: string | null;
}

export const loadGridsFromPg = async (): Promise<DailyGrid[]> => {
  const [cells, chainCells, chainNames, chainDays] = await Promise.all([
    allRows<GridRow>(
      `SELECT day::text AS day, ekatte, pid, min_eur, avg_eur, max_eur, median_eur,
              promo_min_eur, stores, chains, cheapest_eik, cheapest_store
         FROM price_grid_days ORDER BY day, ekatte, pid`,
    ),
    allRows<{
      day: string;
      ekatte: string;
      eik: string;
      pid: number;
      min_eur: number;
    }>(
      `SELECT day::text AS day, ekatte, eik, pid, min_eur
         FROM price_chain_grid_days ORDER BY day, ekatte, eik, pid`,
    ),
    allRows<{ eik: string; name: string }>(
      "SELECT eik, name FROM price_chains",
    ),
    allRows<{ day: string; chains: string; rows: string }>(
      `SELECT day::text AS day, count(*) AS chains, sum(rows) AS rows
         FROM price_chain_days GROUP BY day`,
    ),
  ]);

  const names = Object.fromEntries(chainNames.map((r) => [r.eik, r.name]));
  const stats = new Map(chainDays.map((r) => [r.day, r]));
  const byDay = new Map<string, DailyGrid>();

  const get = (day: string): DailyGrid => {
    let g = byDay.get(day);
    if (!g) {
      g = {
        date: day,
        cells: {},
        chainCells: {},
        // chainNames is the full registry rather than the day's reporters. Only
        // buildChains() reads it, and only to label an eik it already found in
        // that day's chainCells, so a superset is harmless.
        chainNames: names,
        stats: { chains: 0, rows: 0, settlements: 0 },
      };
      byDay.set(day, g);
    }
    return g;
  };

  for (const r of cells) {
    const g = get(r.day);
    const agg: CellAgg = {
      min: Number(r.min_eur),
      avg: Number(r.avg_eur),
      max: Number(r.max_eur),
      median: Number(r.median_eur),
      cheapestEik: r.cheapest_eik ?? "",
      cheapestStore: r.cheapest_store ?? "",
      stores: Number(r.stores),
      chains: Number(r.chains),
      promoMin: r.promo_min_eur == null ? null : Number(r.promo_min_eur),
    };
    (g.cells[r.ekatte] ??= {})[r.pid] = agg;
  }

  for (const r of chainCells) {
    const g = get(r.day);
    ((g.chainCells[r.ekatte] ??= {})[r.eik] ??= {})[r.pid] = Number(r.min_eur);
  }

  for (const [day, g] of byDay) {
    const s = stats.get(day);
    g.stats = {
      chains: s ? Number(s.chains) : 0,
      rows: s ? Number(s.rows) : 0,
      settlements: Object.keys(g.cells).length,
    };
  }

  return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
};
