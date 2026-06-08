// Parse one daily ZIP → an aggregated per-day grid in data/prices/_cache/daily/.
// Collapses ~1.45M store rows into per (settlement × product) min/avg/max/median
// + per-chain min (for chain comparison). The _cache dir is excluded from
// bucket:sync, so these stay local and let build_index rebuild without
// re-downloading.

import fs from "node:fs";
import path from "node:path";
import unzipper from "unzipper";
import { parseChainCsv } from "./lib/normalize";
import { resolvePlace } from "./lib/locations";
import type { CellAgg, DailyGrid } from "./types";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const CACHE_DIR = path.join(ROOT, "data/prices/_cache/daily");

interface Accum {
  prices: number[];
  stores: Set<string>;
  eikMin: Map<string, number>;
  promos: number[];
}

const median = (sorted: number[]): number => {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const parseDay = async (
  zipPath: string,
  date: string,
): Promise<DailyGrid> => {
  // ekatte -> productId -> Accum
  const cells = new Map<string, Map<number, Accum>>();
  const chainNames = new Map<string, string>();
  const settlementSet = new Set<string>();
  const chainSet = new Set<string>();
  let rowCount = 0;
  let unresolved = 0;
  let legacyCodes = 0;

  const dir = await unzipper.Open.file(zipPath);
  const csvFiles = dir.files.filter((f) => /\.csv$/i.test(f.path));
  for (const f of csvFiles) {
    const buf = await f.buffer();
    const rows = parseChainCsv(buf.toString("utf8"), f.path);
    for (const r of rows) {
      if (r.productId === 0) {
        legacyCodes++;
        continue;
      }
      const place = resolvePlace(r.ekatte);
      if (!place) {
        unresolved++;
        continue;
      }
      const ek = place.ekatte;
      rowCount++;
      settlementSet.add(ek);
      chainSet.add(r.eik);
      chainNames.set(r.eik, r.chain);
      let byProd = cells.get(ek);
      if (!byProd) cells.set(ek, (byProd = new Map()));
      let a = byProd.get(r.productId);
      if (!a)
        byProd.set(
          r.productId,
          (a = {
            prices: [],
            stores: new Set(),
            eikMin: new Map(),
            promos: [],
          }),
        );
      a.prices.push(r.price);
      a.stores.add(r.eik + "|" + r.store);
      const prev = a.eikMin.get(r.eik);
      if (prev === undefined || r.price < prev) a.eikMin.set(r.eik, r.price);
      if (r.promo != null) a.promos.push(r.promo);
    }
  }

  // Materialize aggregates.
  const outCells: DailyGrid["cells"] = {};
  const chainCells: DailyGrid["chainCells"] = {};
  for (const [ek, byProd] of cells) {
    outCells[ek] = {};
    for (const [pid, a] of byProd) {
      const sorted = [...a.prices].sort((x, y) => x - y);
      let cheapestEik = "";
      let cheapestVal = Infinity;
      for (const [eik, v] of a.eikMin) {
        if (v < cheapestVal) {
          cheapestVal = v;
          cheapestEik = eik;
        }
        ((chainCells[ek] ??= {})[eik] ??= {})[pid] = v;
      }
      const agg: CellAgg = {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        median: median(sorted),
        avg: a.prices.reduce((s, v) => s + v, 0) / a.prices.length,
        cheapestEik,
        stores: a.stores.size,
        chains: a.eikMin.size,
        promoMin: a.promos.length ? Math.min(...a.promos) : null,
      };
      outCells[ek][pid] = agg;
    }
  }

  const grid: DailyGrid = {
    date,
    cells: outCells,
    chainCells,
    chainNames: Object.fromEntries(chainNames),
    stats: {
      chains: chainSet.size,
      rows: rowCount,
      settlements: settlementSet.size,
    },
  };

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${date}.json`), JSON.stringify(grid));

  console.log(
    `[prices] ${date}: ${rowCount.toLocaleString()} rows · ${settlementSet.size} settlements · ${chainSet.size} chains` +
      (unresolved ? ` · ${unresolved} unresolved` : "") +
      (legacyCodes ? ` · ${legacyCodes} legacy-code rows skipped` : ""),
  );
  return grid;
};
