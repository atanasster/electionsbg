// Aggregate the per-day grids into the shipped artifacts.
//
// The LIVE input is `price_grid_days` + `price_chain_grid_days` in Postgres,
// read by scripts/prices/lib/grids_pg.ts and passed in by build_payloads.ts,
// which emits to the `price_payloads` table rather than to disk. The
// data/prices/_cache/daily/*.json tree this file still falls back to is FROZEN
// (its only writer, parse.ts, was retired by the Postgres migration; it ends
// 2026-07-09) and is kept solely so prices_payload_parity.data.test.ts can
// compare the two sources over the day span they share.
//
// Artifacts:
//   index.json                  national + per-oblast + per-category Jevons
//                               price index since the euro, + dictionary
//   settlement/<ekatte>.json    per-place snapshot (min/avg/max + cheapest chain)
//   ranking.json                per-place basket level + index, ranked across
//                               national / size-class / oblast peer groups
//   chains.json + chains/<muni> chain comparison (intersection-basket fairness)
//
// See docs/plans/prices_kolkostruva_design.md and docs/plans/prices-hub-v1.md.
// NOT official CPI — a monitoring basket index.
//
// TWO BASES LIVE IN THESE ARTIFACTS AND THEY ARE NOT THE SAME. Do not read a
// property of one onto the other:
//
//   INDEX figures — index.json, and indexSinceEuro / change30d /
//   basketSeriesWeekly / byCategory / topMovers on every shard — are an
//   unweighted Jevons over products, of the median across panel settlements of
//   each settlement's median across the chains that priced the product on BOTH
//   days being compared. That last clause is load-bearing (see matchedCell):
//   the КЗП reporter set is not stable, so an index built on whoever filed
//   today measures the sample.
//
//   LEVEL figures — basketLevel, every rank derived from it (the "Най-евтини
//   области" board), and all of chains.json / chains/<muni>.json — are a
//   single raw day over whichever stores filed, and remain exposed to exactly
//   the reporter-set drift the index was fixed for. Measured on a CALM
//   transition (206 → 208 chains): 6 places entered the basket board, 4
//   dropped out, max |rank change| 33.
//
//   ⚠️ That exposure is DISCLOSED, not fixed. This payload now carries a
//   `coverage` block — chainsComplete / chains / trailingMedian / latestDate —
//   which every LEVEL surface renders through PriceCoverageNote so a reader of
//   a thin day is told the gaps may be composition rather than price. The
//   levels themselves are unchanged, and moving them onto a matched panel
//   (plan T3) was attempted and REVERTED: it reached only the settlement tier
//   while the cheapest board is the OBLAST tier, and per-place baselines bias
//   newcomers cheaper. So the note is currently the ONLY mitigation, and
//   `latestDate` — not `headlineDate` — is what it must be captioned with,
//   because the place payloads are built from the latest day.

import fs from "node:fs";
import path from "node:path";
import { resolvePlace } from "./lib/locations";
import { trailingChainMedian, clearsCoverageFloor } from "./lib/coverage";
import type { DailyGrid, ProductDict, PopBand, PlaceLoc } from "./types";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const CACHE_DIR = path.join(ROOT, "data/prices/_cache/daily");
const OUT_DIR = path.join(ROOT, "data/prices");

const products: ProductDict = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts/prices/products.json"), "utf8"),
);
const municipalities: { obshtina: string; name: string; name_en: string }[] =
  JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/municipalities.json"), "utf8"),
  );
const regions: { oblast: string; name: string; name_en: string }[] = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/data/json/regions.json"), "utf8"),
);
const muniName = new Map(municipalities.map((m) => [m.obshtina, m.name]));
const oblastName = new Map(regions.map((r) => [r.oblast, r.name]));

const ALL_PIDS = products.products.map((p) => p.id);

// products.json carries `unit_priced`, an ingest-side flag that gates whether a
// product may be compared across chains. It is not a client concern and must not
// leak into the shipped dictionary — it is the only thing that would otherwise
// change index.json/dict.json byte-for-byte.
const PUBLIC_PRODUCTS = products.products.map(({ id, cat, bg, en }) => ({
  id,
  cat,
  bg,
  en,
}));
const PIDS_BY_CAT = new Map<number, number[]>();
for (const p of products.products) {
  const arr = PIDS_BY_CAT.get(p.cat) ?? [];
  arr.push(p.id);
  PIDS_BY_CAT.set(p.cat, arr);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Matched-model Jevons index (100-based) of `now` vs `base` over `pids`.
 *
 *  Returns the matched product count `n` WITH the value, and null when nothing
 *  matched. Both halves are load-bearing. `n` is the figure's denominator — the
 *  chain matching below is strictly narrower than the pooled basis it replaced,
 *  so two settlements' indices can rest on 101 products and on 4, and nothing
 *  else in the payload distinguishes them. And null must stay distinguishable
 *  from 100: on a 100-based index 100 asserts "exactly where it was on euro
 *  day", which is the most plausible-looking number this series can fabricate. */
const jevons = (
  now: Map<number, number>,
  base: Map<number, number>,
  pids: number[],
): { v: number; n: number } | null => {
  let sum = 0;
  let n = 0;
  for (const g of pids) {
    const pd = now.get(g);
    const pb = base.get(g);
    if (pd && pb && pd > 0 && pb > 0) {
      sum += Math.log(pd / pb);
      n++;
    }
  }
  return n ? { v: 100 * Math.exp(sum / n), n } : null;
};

/** Products below which a settlement's index is kept on its own page but taken
 *  off the cross-place since-euro board — the index twin of the existing
 *  `basketLevel != null` gate. Measured on the 2026-08 corpus, 6 settlements
 *  publish an index over fewer than 10 of 101 products and two over 4. */
const MIN_INDEX_PRODUCTS = 10;

// Re-exported so a reader of this file finds the coverage vocabulary where it
// is used. The definitions live in ./lib/coverage.ts because the INGEST guard
// reads them too, and the two must not drift.
export {
  COVERAGE_WINDOW_DAYS,
  COVERAGE_FLOOR,
  trailingChainMedian,
} from "./lib/coverage";

interface LoadedDay {
  date: string;
  // ekatte -> pid -> settlement MIN price (cheapest store) — for "cheapest" level
  settMin: Map<string, Map<number, number>>;
  grid: DailyGrid;
}

const pushVal = (m: Map<number, number[]>, pid: number, v: number) => {
  let a = m.get(pid);
  if (!a) m.set(pid, (a = []));
  a.push(v);
};
const medianOf = (m: Map<number, number[]>): Map<number, number> =>
  new Map([...m].map(([pid, xs]) => [pid, median(xs)]));

/** One settlement's chain-MATCHED prices on two days.
 *
 *  Per product, the median across the chains that priced it on BOTH days —
 *  returned as two vectors over the same matched chain set, so a chain joining
 *  or leaving the feed cancels between them instead of moving the ratio.
 *
 *  This is the fix for the defect measured on 2026-08-09: the КЗП reporter set
 *  fell 203 → 98 chains in six days, and because the index basis was a median
 *  over whatever shops filed that day, the national index dropped 4.19 points
 *  in 24 hours with no price moving. Holding the panel matched over the same
 *  transition moves it +0.11, and cuts day-to-day σ from 2.1 to 0.57.
 *
 *  Note the basis is the per-chain MINIMUM (the only price `chainCells` carries)
 *  rather than the median over raw store rows the old basis used. That estimator
 *  change is deliberate: raw rows carry no chain attribution, so they cannot be
 *  matched at all. It shifts the LEVEL (~100.8 → ~97.7 on 2026-08-14) as well as
 *  removing the drift, which is why `note` on the payload states the basis.
 *
 *  CONTRACT
 *  - `now` and `base` always have IDENTICAL key sets, so `base.get(pid)!` is
 *    safe for any pid in `now`. A product enters both or neither.
 *  - Either side missing (a settlement absent on one of the days) yields two
 *    EMPTY maps, never a partial result.
 *  - The value per product is the ratio of two medians over the matched set,
 *    NOT the median of the per-chain ratios. With an even number of matched
 *    chains the two medians may interpolate between different chains. Both
 *    forms are defensible; this is the one the plan's isolation experiment
 *    used, and the payload `note` says so.
 *  - `chains` counts the chains that matched at least one product — the second
 *    denominator (a settlement resting on ONE chain is not the same claim as
 *    one resting on twenty).
 *  - Exported for `build_index.test.ts`; not part of the artifact contract. */
export const matchedCell = (
  nowByEik: Record<string, Record<string, number>> | undefined,
  baseByEik: Record<string, Record<string, number>> | undefined,
): { now: Map<number, number>; base: Map<number, number>; chains: number } => {
  const nowAcc = new Map<number, number[]>();
  const baseAcc = new Map<number, number[]>();
  if (!nowByEik || !baseByEik)
    return { now: new Map(), base: new Map(), chains: 0 };
  let chains = 0;
  // Matching on the CHAIN first is what keeps this allocation-cheap: the day's
  // grid is already keyed eik -> pid, so an unmatched chain is skipped whole
  // rather than transposed. (A transposed ekatte -> pid -> eik copy of all 225
  // days OOMs an 8 GB heap.)
  for (const eik of Object.keys(nowByEik)) {
    const basePrices = baseByEik[eik];
    if (!basePrices) continue;
    const nowPrices = nowByEik[eik];
    let matchedHere = false;
    for (const pid of Object.keys(nowPrices)) {
      const nv: number | undefined = nowPrices[pid];
      // Typed explicitly: the Record's index signature says `number`, but this
      // is `undefined` for every product the chain did not price on the base
      // day — the common case, and the entire point of the guard. Without the
      // annotation a later `bv >= 0` or `bv != null` edit type-checks and
      // silently stops matching.
      const bv: number | undefined = basePrices[pid];
      if (nv != null && bv != null && nv > 0 && bv > 0) {
        pushVal(nowAcc, +pid, nv);
        pushVal(baseAcc, +pid, bv);
        matchedHere = true;
      }
    }
    if (matchedHere) chains++;
  }
  return { now: medianOf(nowAcc), base: medianOf(baseAcc), chains };
};

/** eik -> pid -> every per-chain minimum observed across `eks`, on one day.
 *  The accumulation `buildChains` needs for both its national and its
 *  per-município pass — one spelling, and it reuses the module's own `pushVal`
 *  rather than the older `get() ?? []; push; set()` idiom that re-set the map
 *  on every push. */
const chainPidValues = (
  chainCells: DailyGrid["chainCells"],
  eks: Iterable<string>,
): Map<string, Map<number, number[]>> => {
  const out = new Map<string, Map<number, number[]>>();
  for (const ek of eks) {
    const byEik = chainCells[ek];
    if (!byEik) continue;
    for (const [eik, byPid] of Object.entries(byEik)) {
      let m = out.get(eik);
      if (!m) out.set(eik, (m = new Map<number, number[]>()));
      for (const [pid, v] of Object.entries(byPid)) pushVal(m, +pid, v);
    }
  }
  return out;
};

/**
 * Where an artifact goes. The maths below is unchanged from the file-writing
 * era; only the sink is pluggable, so build_payloads.ts can send the very same
 * objects to `price_payloads` instead of to disk. Keeping one code path is what
 * makes the parity harness meaningful.
 */
export type Emit = (kind: string, key: string, obj: unknown) => void;

const fileEmit: Emit = (kind, key, obj) => {
  const rel =
    kind === "place"
      ? path.join("settlement", `${key}.json`)
      : kind === "chains-muni"
        ? path.join("chains", `${key}.json`)
        : `${kind}.json`;
  const file = path.join(OUT_DIR, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
};

const toLoadedDay = (grid: DailyGrid): LoadedDay => {
  const settMin = new Map<string, Map<number, number>>();
  for (const [ek, byProd] of Object.entries(grid.cells)) {
    const mn = new Map<number, number>();
    for (const [pid, agg] of Object.entries(byProd)) mn.set(+pid, agg.min);
    settMin.set(ek, mn);
  }
  // A per-settlement MEDIAN map used to live here too. It was the old index
  // basis; matchedCell replaced it, and holding it cost a measured ~180 MB of
  // heap (1284 → 1104 MB over 189 days) for a key set identical to settMin's.
  return { date: grid.date, settMin, grid };
};

const loadDaysFromCache = (): LoadedDay[] => {
  const files = fs
    .readdirSync(CACHE_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  return files.map((f) =>
    toLoadedDay(JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), "utf8"))),
  );
};

/**
 * `grids` defaults to the legacy _cache tree so the old JSON path still works
 * during the migration; build_payloads.ts passes grids read from
 * `price_grid_days`, which reproduces DailyGrid exactly (verified cell-for-cell
 * by scripts/db/tests/prices_grid_parity.data.test.ts).
 */
export const buildPriceIndex = (
  opts: { grids?: DailyGrid[]; emit?: Emit } = {},
): void => {
  const emit = opts.emit ?? fileEmit;
  const days = opts.grids ? opts.grids.map(toLoadedDay) : loadDaysFromCache();
  if (days.length === 0) {
    throw new Error("no daily grids — run the ingest first");
  }
  const dates = days.map((d) => d.date);
  const baselineDate = dates[0];
  const latestDate = dates[dates.length - 1];
  const latest = days[days.length - 1];
  const baseline = days[0];
  // Fixed reference panel: settlements present on the baseline (euro) day. All
  // index + since-euro leaderboards use only panel settlements, so the series
  // tracks the same markets over time rather than drifting as the feed's
  // settlement coverage changes. Non-panel places still get their own page.
  // Membership is fixed at the baseline day. Keyed off chainCells rather than
  // cells because chainCells IS what gets matched — the two key sets are equal
  // by construction (both grouped from the same stage rows; verified 0 either
  // way on the euro-day grid), so this is the same panel named against the
  // structure that decides it.
  const panel = new Set(Object.keys(baseline.grid.chainCells));
  const inPanel = (eks: string[]) => eks.filter((ek) => panel.has(ek));
  // index of the day ~30 days before latest (for change30d)
  const latestMs = Date.parse(latestDate);
  let day30 = baseline;
  for (const d of days) {
    if (latestMs - Date.parse(d.date) >= 30 * 86400_000) day30 = d;
  }

  // ── geography: which settlements belong to each oblast / muni ──
  const allEkattes = new Set<string>();
  for (const d of days) for (const ek of d.settMin.keys()) allEkattes.add(ek);
  const place = new Map<string, PlaceLoc>();
  for (const ek of allEkattes) {
    const p = resolvePlace(ek);
    if (p) place.set(ek, p);
  }
  const oblastSetts = new Map<string, string[]>();
  const muniSetts = new Map<string, string[]>();
  for (const [ek, p] of place) {
    (
      oblastSetts.get(p.oblast) ?? oblastSetts.set(p.oblast, []).get(p.oblast)!
    ).push(ek);
    (
      muniSetts.get(p.obshtina) ??
      muniSetts.set(p.obshtina, []).get(p.obshtina)!
    ).push(ek);
  }

  const allEk = [...allEkattes];
  const panelEk = inPanel(allEk); // fixed for the whole build — never per day
  const oblastOf = new Map([...place].map(([ek, p]) => [ek, p.oblast]));

  // Chain-matched representative prices per day, nationally and per oblast.
  //
  // Each day yields a PAIR of vectors — that day's prices and the baseline's —
  // over the SAME matched chain set, so the baseline half legitimately differs
  // from day to day. That is what makes the series robust to a reporter set
  // that changes size: a chain absent on either side contributes to neither.
  // National and oblast reps are accumulated in ONE pass over settlements,
  // since each settlement belongs to exactly one oblast.
  interface RepPair {
    now: Map<number, number>;
    base: Map<number, number>;
  }
  const repNat: RepPair[] = [];
  const repObl = new Map<string, RepPair[]>();
  for (const obl of oblastSetts.keys()) repObl.set(obl, []);
  // ek -> per-day index vs the BASELINE day. Filled by the pass below, which
  // already computes every matchedCell it needs; basketSeriesWeekly then reads
  // instead of recomputing ~7k identical calls. Non-panel settlements
  // (baseIdx > 0) are absent here and still recompute, correctly — their base
  // day is their own first-seen, not the baseline.
  const settIdxVsBase = new Map<string, (number | null)[]>();
  // Settlements CONTRIBUTING per day, as opposed to panel membership. The gap
  // is the residual this change does not close: it matches chains within a
  // settlement, not settlements across the compared days. Measured over 188
  // consecutive day pairs, the drift attributable to that cross-section is at
  // most 0.330 index points (p95 0.235, median 0.052) — an order of magnitude
  // below the 4.19-point defect matchedCell fixes, and on the largest genuine
  // move in the series (+2.37) it accounts for 0.04. Recorded, not fixed.
  const contributing: number[] = [];

  for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
    const day = days[dayIdx];
    const natNow = new Map<number, number[]>();
    const natBase = new Map<number, number[]>();
    const oblNow = new Map<string, Map<number, number[]>>();
    const oblBase = new Map<string, Map<number, number[]>>();
    let contributed = 0;
    for (const ek of panelEk) {
      const { now, base } = matchedCell(
        day.grid.chainCells[ek],
        baseline.grid.chainCells[ek],
      );
      let series = settIdxVsBase.get(ek);
      if (!series)
        settIdxVsBase.set(ek, (series = new Array(days.length).fill(null)));
      const own = jevons(now, base, ALL_PIDS);
      series[dayIdx] = own == null ? null : own.v;
      if (!now.size) continue;
      contributed++;
      const obl = oblastOf.get(ek);
      let on: Map<number, number[]> | undefined;
      let ob: Map<number, number[]> | undefined;
      if (obl) {
        on = oblNow.get(obl);
        if (!on) oblNow.set(obl, (on = new Map()));
        ob = oblBase.get(obl);
        if (!ob) oblBase.set(obl, (ob = new Map()));
      }
      for (const [pid, v] of now) {
        const bv = base.get(pid)!;
        pushVal(natNow, pid, v);
        pushVal(natBase, pid, bv);
        if (on && ob) {
          pushVal(on, pid, v);
          pushVal(ob, pid, bv);
        }
      }
    }
    contributing.push(contributed);
    repNat.push({ now: medianOf(natNow), base: medianOf(natBase) });
    for (const [obl, series] of repObl)
      series.push({
        now: medianOf(oblNow.get(obl) ?? new Map()),
        base: medianOf(oblBase.get(obl) ?? new Map()),
      });
  }

  // ── index.json ──
  // `n` rides every point: without it `v: 100` is ambiguous between "exactly
  // where it was on euro day" and "nothing matched" (n = 0). Consumers that
  // only read `v` are unaffected — the field is additive.
  const natSeries = days.map((_, i) => {
    const j = jevons(repNat[i].now, repNat[i].base, ALL_PIDS);
    return { d: dates[i], v: r1(j?.v ?? 100), n: j?.n ?? 0 };
  });
  const byCategory: Record<number, { d: string; v: number }[]> = {};
  for (const cat of products.categories) {
    const pids = PIDS_BY_CAT.get(cat.id) ?? [];
    byCategory[cat.id] = days.map((_, i) => {
      const j = jevons(repNat[i].now, repNat[i].base, pids);
      return { d: dates[i], v: r1(j?.v ?? 100), n: j?.n ?? 0 };
    });
  }
  // Restricted to the panel, so it drifts on the same axis the index does.
  // Unlike the index this is a LEVEL with no baseline to cancel against, so
  // composition passes straight through: the largest 2026-08 dropouts were
  // pharmacies (СОФАРМАСИ, РЕМЕДИУМ), which promote on a completely different
  // cadence from hypermarkets, and their exit moves this with no promotion
  // changing. The panel bounds that; it does not eliminate it.
  const promoShare = days.map((d, i) => {
    let cells = 0;
    let promo = 0;
    for (const [ek, byProd] of Object.entries(d.grid.cells)) {
      if (!panel.has(ek)) continue;
      for (const agg of Object.values(byProd)) {
        cells++;
        if (agg.promoMin != null) promo++;
      }
    }
    return { d: dates[i], v: cells ? r3(promo / cells) : 0 };
  });
  const regionsOut: Record<
    string,
    { name: string; index: { d: string; v: number }[] }
  > = {};
  for (const [obl, series] of repObl) {
    regionsOut[obl] = {
      name: oblastName.get(obl) ?? obl,
      index: days.map((_, i) => {
        const j = jevons(series[i].now, series[i].base, ALL_PIDS);
        return { d: dates[i], v: r1(j?.v ?? 100), n: j?.n ?? 0 };
      }),
    };
  }

  // Coverage completeness per day, from the reporter counts the grids carry.
  const chainsPerDay = days.map((d) => d.grid.stats.chains);
  // No history to judge against ⇒ not judged incomplete. The alternative would
  // mark the first fortnight of the corpus unusable.
  const dayComplete = days.map((_, i) =>
    clearsCoverageFloor(chainsPerDay[i], trailingChainMedian(chainsPerDay, i)),
  );
  const latestTrailingMedian = trailingChainMedian(
    chainsPerDay,
    days.length - 1,
  );
  const latestComplete = dayComplete[days.length - 1];
  // The publish-side gate. `dayComplete[0]` is unconditionally true — the
  // opening day has no history to be judged against and a null median counts as
  // complete — and `days.length === 0` already threw above, so this always
  // finds one. No `?? latestDate` fallback: it would be dead code that silently
  // resurrects the defect if the "opening days are complete" rule ever changed.
  // The degradation to watch for is therefore a STALE headline, not a missing
  // one, which is why the build log prints how far back the gate reached.
  // Prefer a day that was actually JUDGED complete over one that merely had no
  // history to be judged against. A descriptive field could afford that loose
  // rule; `headlineDate` is normative, and on a short or
  // zero-prefixed span the loose rule would headline an arbitrarily thin day.
  // Falls back to the loose set when nothing was ever judged, which is the
  // corpus's own first fortnight.
  const judged = days.map(
    (_, i) => trailingChainMedian(chainsPerDay, i) != null && dayComplete[i],
  );
  const lastCompleteIdx = judged.includes(true)
    ? judged.lastIndexOf(true)
    : dayComplete.lastIndexOf(true);
  const headlineDate = dates[lastCompleteIdx];
  const incompleteDates = dates.filter((_, i) => !dayComplete[i]);

  const indexJson = {
    source: {
      name: "КЗП — Колко струва",
      nameEn: "CPC — How Much Does It Cost",
      url: "https://kolkostruva.bg/opendata",
    },
    // The DATA date (midnight UTC of latestDate), not a wall-clock fetch time —
    // deliberately, since the parity harness needs a deterministic artifact.
    // `dataAsOf` is the name to read; `fetchedAt` is kept for consumers that
    // still reference it and holds the identical value.
    dataAsOf: latestDate,
    fetchedAt: new Date(latestMs).toISOString(),
    firstDate: baselineDate,
    latestDate,
    baseline: baselineDate,
    note: "Monitoring basket index: unweighted Jevons over products of the median across panel settlements of each settlement's median across CHAIN-MATCHED per-chain minimum prices (only chains reporting on both the compared day and the baseline contribute). Each point is the RATIO OF THE TWO MEDIANS over the matched set, not the median of per-chain ratios. `n` on each point is how many of the products matched. promoShare is panel-restricted but is a LEVEL with no baseline to cancel composition against. coverage.chainsComplete is the day's reporter count against its own trailing median (COVERAGE_FLOOR of COVERAGE_WINDOW_DAYS loaded days) — it qualifies comparability with neighbouring days only, and says nothing about products, settlements or rows. headlineDate is the day a single quoted figure MUST be taken from — the latest day when it is complete, else the last complete one; the series still carries every day, and incompleteDates lists those below the floor. Like chainsComplete it is a REPORTER-COUNT judgement only: a day it clears can still be thin on products or settlements, and the opening days of the corpus clear it for want of anything to be judged against. NOT official CPI/HICP.",
    coverage: {
      settlements: latest.settMin.size,
      chains: latest.grid.stats.chains,
      rows: latest.grid.stats.rows,
      // How this day's reporter count compares with the days before it. A
      // consumer must be able to qualify the headline rather than the reader
      // having to: on 2026-08-14 `chains` was 98 against a trailing median of
      // 203.5 — 48% of normal, the least-complete day in all 225 — and the
      // page headlined it with no qualifier at all.
      chainsTrailingMedian: latestTrailingMedian,
      // F005: named for its basis, like every other key here. "Complete"
      // alone would not say complete BY WHAT — this is the reporter count
      // against its own trailing median, and says nothing about products,
      // settlements or rows.
      chainsComplete: latestComplete,
      // THE DAY A HEADLINE MUST BE TAKEN FROM: the most recent day whose
      // reporter count clears the floor. On 2026-08-14's corpus, 2026-08-08.
      //
      // The series still ships every day — a chart should show the incomplete
      // tail (dimmed, via incompleteDates) rather than pretend it is not
      // there. What must not happen is a single headline number quoted off a
      // day the feed under-reported: that is exactly how production said +0.8%
      // while localhost said −1.5%, one day apart on the same corpus. Measured
      // on that corpus the two days are 101.4 and 98.7 — the gate flips the
      // SIGN of the sentence the page prints.
      //
      // Deliberately ONE key, not a `headlineDate` beside a
      // `lastCompleteDate`: when the latest day is complete it IS the last
      // complete day, so the two could never differ, and two keys for one
      // value invite a consumer to pick the wrong one.
      headlineDate,
      // Every day below the floor, so a consumer can mark them without
      // re-deriving the rule. Sparse by construction (6 of 225 today) — this
      // is deliberately ONE list rather than a flag per point, since
      // completeness is a property of the DAY and would otherwise be repeated
      // across all ~43 series.
      incompleteDates,
    },
    categories: products.categories,
    products: PUBLIC_PRODUCTS,
    national: { index: natSeries, byCategory, promoShare },
    regions: regionsOut,
  };
  emit("index", "", indexJson);

  // ── core grocery basket for cross-place comparison ──
  // The products present in ~all settlements are non-food packaged goods (tea,
  // water, toothpaste) — a poor "cost of groceries" proxy. So we fix a curated
  // staple food basket (each ≥82% present). Places not pricing the full core
  // are tiny outlets and get rank=null; their index/change still compute.
  const commonBasket = [1, 6, 9, 11, 35, 38, 40, 42, 52, 54, 55, 61].filter(
    (g) => ALL_PIDS.includes(g),
  );

  // ── outlier guard for basket-level comparison ──
  // Several КЗП basket items — notably the two cheeses (сирене id 9, кашкавал
  // id 11) — span a 200 g–1 kg pack range, so a shop selling only a 1 kg pack /
  // by the kilo reports ~5× a small-pack shop. In a single-store village that
  // lone reading becomes the settlement "minimum" with nothing cheaper to offset
  // it, and a cluster of such villages then drags the oblast/muni
  // median-of-minimums (КООП's flat 12.78 €/kg kashkaval, replicated across 7 of
  // Ruse oblast's 11 panel settlements, doubled its basket to ~30 € — twice any
  // other oblast). Treat any per-settlement minimum above 3× the national median
  // of per-settlement minimums for that product as not a comparable basket
  // observation and skip it. The 10 well-behaved staples never trip this (their
  // national max is < 3× the median); only the pack-ambiguous cheeses are
  // guarded. Effect: a settlement whose only cheese is sold by the kilo drops
  // out of the basket leaderboard (nPriced < core size → unranked) instead of
  // registering a spurious ~30 € basket, and the regional/chain rollups reflect
  // real small-pack markets. The per-product min/avg/max shown on each place
  // page (and the Jevons index, which uses price ratios that cancel pack size)
  // are untouched — this guards only the absolute basket-level sum.
  const BASKET_OUTLIER_MULT = 3;
  const basketCap = new Map<number, number>();
  for (const g of commonBasket) {
    const mins: number[] = [];
    for (const m of latest.settMin.values()) {
      const v = m.get(g);
      if (v != null && v > 0) mins.push(v);
    }
    if (mins.length) basketCap.set(g, BASKET_OUTLIER_MULT * median(mins));
  }
  const withinBasketCap = (g: number, v: number): boolean => {
    const c = basketCap.get(g);
    return c == null || v <= c;
  };

  // Sample dates for the settlement sparkline: all days when the series is
  // short, else weekly (every 7th, keeping first + last). Once the full
  // contiguous backfill lands the weekly stride lines up with calendar weeks.
  const allIdx = days.map((_, i) => i);
  const weeklyIdx =
    days.length <= 60
      ? allIdx
      : allIdx.filter((i) => i === 0 || i === days.length - 1 || i % 7 === 0);

  // ── settlement/<ekatte>.json ──
  // Built into memory first; the per-place `rank` block is attached after
  // ranks are computed, then written — so the place dashboard can read its
  // rank from its own shard and never load the 128 KB ranking.json.
  const settJsonByEk = new Map<string, Record<string, unknown>>();

  // per-place rank inputs accumulate here for ranking.json
  interface RankRow {
    code: string;
    tier: "settlement" | "muni" | "oblast";
    name: string;
    muni?: string;
    oblast: string;
    basketLevel: number | null;
    nPriced: number;
    indexSinceEuro: number;
    // Denominators for indexSinceEuro. The matched basis is strictly narrower
    // than the pooled one it replaced and varies enormously by place, so a
    // number resting on 4 products / 1 chain and one resting on 101 / 20 must
    // not be indistinguishable. This is the index twin of `nPriced` beside
    // `basketLevel`.
    indexN: number;
    indexChains: number;
    change30d: number;
    popBand: PopBand | null;
    sinceEuro: boolean; // present on euro day → eligible for since-euro board
  }
  const rankRows: RankRow[] = [];

  const firstSeen = new Map<string, number>(); // ekatte -> day index first present
  for (let i = 0; i < days.length; i++)
    for (const ek of days[i].settMin.keys())
      if (!firstSeen.has(ek)) firstSeen.set(ek, i);

  for (const ek of latest.settMin.keys()) {
    // Skip any ekatte resolvePlace() couldn't map — the geography loop above
    // (line ~203) already skips these, so `place` won't have them, and the `!`
    // would otherwise throw mid-build on a messy feed. Same handling as there.
    const p = place.get(ek);
    if (!p) continue;
    const cell = latest.grid.cells[ek];
    const baseIdx = firstSeen.get(ek) ?? 0;
    const nowMin = latest.settMin.get(ek)!; // cheapest-store prices (for basket level)
    // index/movers use median (typical) prices to avoid single-store noise
    // Chain-matched, exactly as the national index is — a village whose only
    // discounter stopped reporting must not read as a price rise.
    const vsBase = matchedCell(
      latest.grid.chainCells[ek],
      days[baseIdx].grid.chainCells[ek],
    );
    // A settlement absent 30 days ago falls back to its own baseline day, as it
    // did before the chain-matching change.
    const vs30 = matchedCell(
      latest.grid.chainCells[ek],
      day30.grid.chainCells[ek] ?? days[baseIdx].grid.chainCells[ek],
    );
    const jNow = jevons(vsBase.now, vsBase.base, ALL_PIDS);
    const j30 = jevons(vs30.now, vs30.base, ALL_PIDS);
    const idxNow = jNow?.v ?? 100;
    const idx30 = j30?.v ?? 100;
    const indexN = jNow?.n ?? 0; // matched products behind idxNow (of ALL_PIDS)
    const indexChains = vsBase.chains; // …and matched chains behind those

    const productsOut = Object.entries(cell)
      .map(([pid, agg]) => ({
        id: +pid,
        min: r2(agg.min),
        avg: r2(agg.avg),
        max: r2(agg.max),
        median: r2(agg.median),
        cheapestEik: agg.cheapestEik,
        cheapestChain: latest.grid.chainNames[agg.cheapestEik] ?? "",
        cheapestStore: agg.cheapestStore ?? "",
        stores: agg.stores,
        promoMin: agg.promoMin == null ? null : r2(agg.promoMin),
      }))
      .sort((a, b) => a.id - b.id);

    // per-category change since euro
    const byCat = products.categories
      .map((c) => {
        const pids = PIDS_BY_CAT.get(c.id) ?? [];
        const v = jevons(vsBase.now, vsBase.base, pids);
        const v30 = jevons(vs30.now, vs30.base, pids);
        return v == null
          ? null
          : {
              id: c.id,
              changeSinceEuro: r3(v.v / 100 - 1),
              change30d: v30 == null ? 0 : r3(v30.v / 100 - 1),
            };
      })
      .filter(Boolean);

    // per-product movers since euro (median price)
    const movers = ALL_PIDS.map((g) => {
      const pn = vsBase.now.get(g);
      const pb = vsBase.base.get(g);
      if (!pn || !pb) return null;
      return { id: g, change: r3(pn / pb - 1) };
    })
      .filter((x): x is { id: number; change: number } => !!x)
      .sort((a, b) => b.change - a.change);

    // Panel settlements were already measured against the baseline by the
    // national pass; only a non-panel place (its own later first-seen day as
    // base) has to recompute.
    const stashed = baseIdx === 0 ? settIdxVsBase.get(ek) : undefined;
    const weeklyPoint = (i: number): number => {
      if (stashed) return stashed[i] ?? 100;
      const m = matchedCell(
        days[i].grid.chainCells[ek],
        days[baseIdx].grid.chainCells[ek],
      );
      return jevons(m.now, m.base, ALL_PIDS)?.v ?? 100;
    };
    const basketSeriesWeekly = weeklyIdx
      .filter((i) => i >= baseIdx)
      .map((i) => ({
        d: dates[i],
        v: r1(weeklyPoint(i)),
      }));

    const settJson = {
      ekatte: ek,
      name: p.name,
      nameEn: p.nameEn,
      obshtina: p.obshtina,
      oblast: p.oblast,
      latestDate,
      baselineDate: dates[baseIdx],
      basketChangeSinceEuro: r3(idxNow / 100 - 1),
      // The headline's own denominators, so it is never read bare. indexN = 0
      // means NOT COMPUTABLE, not "unchanged": no chain priced any product in
      // this settlement on both days, and `basketChangeSinceEuro` is then the
      // 0.000 the `?? 100` fallback produces rather than a measurement. This is
      // not hypothetical — on 2026-08-14, after the reporter set halved, 63 of
      // 217 panel settlements were in that state.
      indexN,
      indexChains,
      basketChange30d: r3(idx30 / 100 - 1),
      // The window's real start. A settlement absent 30 days ago falls back to
      // its own first-seen day (1 of 242 on the 2026-08 corpus), so the value
      // can span far more than 30 days and a consumer must be able to say so
      // rather than captioning it "за 30 дни".
      change30dFrom: day30.grid.chainCells[ek] ? day30.date : dates[baseIdx],
      basketSeriesWeekly,
      byCategory: byCat,
      topMovers: { up: movers.slice(0, 5), down: movers.slice(-5).reverse() },
      products: productsOut,
    };
    settJsonByEk.set(ek, settJson);

    // basket level over common basket (per-kg pack outliers excluded — see note)
    let basketLevel: number | null = 0;
    let nPriced = 0;
    for (const g of commonBasket) {
      const v = nowMin.get(g);
      if (v != null && withinBasketCap(g, v)) {
        basketLevel += v;
        nPriced++;
      }
    }
    if (nPriced < commonBasket.length) basketLevel = null;
    rankRows.push({
      code: ek,
      tier: "settlement",
      name: p.name,
      muni: p.obshtina,
      oblast: p.oblast,
      basketLevel: basketLevel == null ? null : r2(basketLevel),
      nPriced,
      indexSinceEuro: r1(idxNow),
      indexN,
      indexChains,
      change30d: r3(idx30 / 100 - 1),
      popBand: p.popBand,
      sinceEuro: panel.has(ek),
    });
  }

  // ── muni + oblast rank rows ──
  const addAggregateRow = (
    code: string,
    tier: "muni" | "oblast",
    name: string,
    oblast: string,
    allEks: string[],
  ) => {
    const eks = inPanel(allEks); // fixed panel for since-euro comparability
    // Chain-matched over the same settlement panel, as the national and
    // per-settlement indices are — a leaderboard that ranked places on a
    // drifting reporter set would rank the feed, not the market.
    const aggRep = (base: LoadedDay) => {
      const now = new Map<number, number[]>();
      const was = new Map<number, number[]>();
      let chains = 0;
      for (const ek of eks) {
        const m = matchedCell(
          latest.grid.chainCells[ek],
          base.grid.chainCells[ek],
        );
        chains = Math.max(chains, m.chains);
        for (const [pid, v] of m.now) {
          pushVal(now, pid, v);
          pushVal(was, pid, m.base.get(pid)!);
        }
      }
      return { now: medianOf(now), base: medianOf(was), chains };
    };
    const vsBase = aggRep(baseline);
    const vs30 = aggRep(day30);
    const jNow = jevons(vsBase.now, vsBase.base, ALL_PIDS);
    const j30 = jevons(vs30.now, vs30.base, ALL_PIDS);
    const idxNow = jNow?.v ?? 100;
    const idx30 = j30?.v ?? 100;
    const indexN = jNow?.n ?? 0; // matched products behind idxNow (of ALL_PIDS)
    const indexChains = vsBase.chains; // …and matched chains behind those
    // representative cheapest level: median over panel settlements of each
    // settlement's minimum, excluding per-kg pack outliers (see note above) so a
    // cluster of single-store villages can't pin the regional median to one
    // chain's by-the-kilo cheese.
    let basketLevel: number | null = 0;
    let nPriced = 0;
    for (const g of commonBasket) {
      const vals: number[] = [];
      for (const ek of eks) {
        const v = latest.settMin.get(ek)?.get(g);
        if (v != null && withinBasketCap(g, v)) vals.push(v);
      }
      if (vals.length) {
        basketLevel += median(vals);
        nPriced++;
      }
    }
    if (nPriced < commonBasket.length) basketLevel = null;
    rankRows.push({
      code,
      tier,
      name,
      oblast,
      basketLevel: basketLevel == null ? null : r2(basketLevel),
      nPriced,
      indexSinceEuro: r1(idxNow),
      indexN,
      indexChains,
      change30d: r3(idx30 / 100 - 1),
      popBand: null,
      sinceEuro: true,
    });
  };
  for (const [obl, eks] of oblastSetts)
    addAggregateRow(obl, "oblast", oblastName.get(obl) ?? obl, obl, eks);
  for (const [obsht, eks] of muniSetts)
    addAggregateRow(
      obsht,
      "muni",
      // Sofia's synthetic obshtina (SOF46) isn't in municipalities.json, so give
      // the city aggregate its real name rather than the raw code.
      obsht === "SOF46" ? "София" : (muniName.get(obsht) ?? obsht),
      place.get(eks[0])!.oblast,
      eks,
    );

  // ── assign ranks within peer groups ──
  const assignRanks = (
    rows: RankRow[],
    groupKey: (r: RankRow) => string | null,
  ): {
    rank: Map<string, number>;
    rankChange: Map<string, number>;
    peers: Map<string, number>;
  } => {
    const groups = new Map<string, RankRow[]>();
    for (const r of rows) {
      const k = groupKey(r);
      if (k == null) continue;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
    }
    const rank = new Map<string, number>();
    const rankChange = new Map<string, number>();
    const peers = new Map<string, number>();
    // Ties are broken on `code`, never left to array order. Two places can share
    // a basketLevel or an indexSinceEuro exactly, and without a tiebreak their
    // rank depends on the order the settlements happened to appear — which used
    // to be ZIP row order and is now `ORDER BY ekatte`. That made two places'
    // rankChange flip when the same data was read from Postgres instead of the
    // JSON cache. Same requirement as reference_pg_payload_determinism.
    const byCode = (a: RankRow, b: RankRow) => (a.code < b.code ? -1 : 1);
    for (const g of groups.values()) {
      // Only rank real-market places (those pricing the full core basket) — keeps
      // sparse-data villages out of both the cheapest and the rose-most boards.
      const lvl = g.filter((r) => r.basketLevel != null);
      const cheapest = [...lvl].sort(
        (a, b) => a.basketLevel! - b.basketLevel! || byCode(a, b),
      );
      cheapest.forEach((r, i) => rank.set(r.code, i + 1));
      // since-euro board: only places present on euro day (genuine comparison)
      // AND measured over enough matched products to be comparable with the
      // rest of the board. A place below the floor keeps its own page and its
      // own number; it just stops being ranked against places measured 25×
      // more thoroughly.
      const chg = lvl
        .filter((r) => r.sinceEuro && r.indexN >= MIN_INDEX_PRODUCTS)
        .sort((a, b) => b.indexSinceEuro - a.indexSinceEuro || byCode(a, b));
      chg.forEach((r, i) => rankChange.set(r.code, i + 1));
      for (const r of lvl) peers.set(r.code, lvl.length);
    }
    return { rank, rankChange, peers };
  };

  const settRows = rankRows.filter((r) => r.tier === "settlement");
  const muniRows = rankRows.filter((r) => r.tier === "muni");
  const oblRows = rankRows.filter((r) => r.tier === "oblast");

  const natSett = assignRanks(settRows, () => "ALL");
  const sizeSett = assignRanks(settRows, (r) => r.popBand);
  const oblSett = assignRanks(settRows, (r) => r.oblast);
  const natMuni = assignRanks(muniRows, () => "ALL");
  const oblMuni = assignRanks(muniRows, (r) => r.oblast);
  const natObl = assignRanks(oblRows, () => "ALL");

  // Sorted by code, not by whatever order the settlements were discovered in.
  // rankRows inherits its order from the daily grid's iteration order — ZIP row
  // order under the old JSON cache, `ORDER BY ekatte` under Postgres — so the
  // emitted array was input-order dependent even though every value in it was
  // identical. Consumers key by `code` (findRankPlace), so this is free.
  const places = [...rankRows]
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((r) => {
      const pick = (
        g: ReturnType<typeof assignRanks>,
        m: "rank" | "rankChange" | "peers",
      ) => g[m].get(r.code) ?? null;
      const out: Record<string, unknown> = {
        code: r.code,
        tier: r.tier,
        name: r.name,
        oblast: r.oblast,
        basketLevel: r.basketLevel,
        nPriced: r.nPriced,
        indexSinceEuro: r.indexSinceEuro,
        indexN: r.indexN,
        indexChains: r.indexChains,
        change30d: r.change30d,
      };
      if (r.muni) out.muni = r.muni;
      if (r.popBand) out.popBand = r.popBand;
      if (r.tier === "settlement") {
        out.rank = {
          national: pick(natSett, "rank"),
          sizeClass: pick(sizeSett, "rank"),
          oblast: pick(oblSett, "rank"),
        };
        out.rankChange = {
          national: pick(natSett, "rankChange"),
          sizeClass: pick(sizeSett, "rankChange"),
          oblast: pick(oblSett, "rankChange"),
        };
        out.peers = {
          national: pick(natSett, "peers"),
          sizeClass: pick(sizeSett, "peers"),
          oblast: pick(oblSett, "peers"),
        };
      } else if (r.tier === "muni") {
        out.rank = {
          national: pick(natMuni, "rank"),
          oblast: pick(oblMuni, "rank"),
        };
        out.rankChange = {
          national: pick(natMuni, "rankChange"),
          oblast: pick(oblMuni, "rankChange"),
        };
        out.peers = {
          national: pick(natMuni, "peers"),
          oblast: pick(oblMuni, "peers"),
        };
      } else {
        out.rank = { national: pick(natObl, "rank") };
        out.rankChange = { national: pick(natObl, "rankChange") };
        out.peers = { national: pick(natObl, "peers") };
      }
      return out;
    });

  // per-place rank summary, keyed by code — embedded into each shard so place
  // dashboards read their rank from their own (already-loaded) shard instead of
  // pulling the full 128 KB ranking.json (only the governance leaderboards do).
  const rankByCode = new Map<string, Record<string, unknown>>();
  for (const p of places) {
    rankByCode.set(p.code as string, {
      basketLevel: p.basketLevel,
      nPriced: p.nPriced,
      indexSinceEuro: p.indexSinceEuro,
      indexN: p.indexN,
      indexChains: p.indexChains,
      change30d: p.change30d,
      popBand: p.popBand ?? null,
      rank: p.rank,
      rankChange: p.rankChange,
      peers: p.peers,
    });
  }

  // Write settlement shards now (with their own rank embedded).
  for (const [ek, json] of settJsonByEk) {
    json.rank = rankByCode.get(ek) ?? null;
    emit("place", ek, json);
  }

  // dict.json — the small product/category dictionary + meta (no series), so a
  // place page resolves product names without the heavy index.json.
  // dict.json deliberately carries the ORIGINAL three coverage fields only.
  // The gate's fields describe a SERIES this payload does not ship, and its
  // consumers (place pages) headline their own per-settlement figures rather
  // than the national one — publishing headlineDate here would invite them to
  // gate a number it says nothing about. incompleteDates also grows without
  // bound, and dict is fetched by every place page.
  emit("dict", "", {
    source: indexJson.source,
    fetchedAt: indexJson.fetchedAt,
    firstDate: baselineDate,
    latestDate,
    baseline: baselineDate,
    coverage: {
      settlements: indexJson.coverage.settlements,
      chains: indexJson.coverage.chains,
      rows: indexJson.coverage.rows,
    },
    categories: products.categories,
    products: PUBLIC_PRODUCTS,
    commonBasket,
    commonBasketSize: commonBasket.length,
  });

  // ⚠️ The coverage judgement travels WITH the ranking, not just with the index.
  //
  // Every figure in `places` is a LEVEL — basketLevel and the ranks derived from
  // it — and this file's own header records that levels "remain exposed to
  // exactly the reporter-set drift the index was fixed for". Until that is
  // fixed (plan T3), a reader of the cheapest-places board is entitled to know
  // that the day it is built from was thin.
  //
  // It is carried here rather than fetched by each tile because the tiles that
  // render these numbers — the price-level tile, the choropleth, the My-Area
  // basket — read `usePriceRanking()` and nothing else. Making each of them
  // fetch index.json to learn whether its own numbers are comparable is how one
  // of them ends up not doing it.
  emit("ranking", "", {
    latestDate,
    baseline: baselineDate,
    commonBasket,
    commonBasketSize: commonBasket.length,
    places,
    coverage: {
      // Did the latest day clear COVERAGE_FLOOR of its own trailing median?
      chainsComplete: latestComplete,
      // The reporter count behind these numbers, and what it is judged against.
      chains: chainsPerDay[days.length - 1] ?? 0,
      trailingMedian: latestTrailingMedian,
      // ⚠️ Deliberately NOT `headlineDate`. `places` is always built from
      // `latestDate`, so publishing the headline day here would caption these
      // rows with a day they are not from — dict.json refuses it for exactly
      // that reason a few lines up. The note dates what it is standing next to.
      latestDate,
    },
  });

  // ── chains.json (national) + chains/<muni>.json ──
  buildChains(latest, commonBasket, muniSetts, rankByCode, basketCap, emit);

  console.log(
    `[prices] built index.json (${dates.length} days ${baselineDate}…${latestDate}), ` +
      `${settRows.length} settlement files, ranking.json (${places.length} places), ` +
      `commonBasket=${commonBasket.length} products`,
  );
  // The two numbers that make the matching's health visible from a build log —
  // it is now the property most likely to degrade silently between runs.
  const lastIdx = days.length - 1;
  const thinSetts = [...settIdxVsBase.values()].filter(
    (a) => a[lastIdx] != null,
  ).length;
  console.log(
    `[prices] matched panel: ${contributing[lastIdx]}/${panelEk.length} settlements on ${latestDate} ` +
      `· ${panelEk.length - thinSetts} with no computable index ` +
      `· national n=${natSeries[lastIdx]?.n ?? 0}/${ALL_PIDS.length} products`,
  );
  console.log(
    `[prices] coverage: ${latest.grid.stats.chains} chains vs trailing median ` +
      `${latestTrailingMedian ?? "n/a"} — ${latestComplete ? "complete" : "INCOMPLETE"}` +
      (latestComplete
        ? ""
        : ` · headline held back ${days.length - 1 - lastCompleteIdx} day(s) to ${headlineDate}` +
          ` (${incompleteDates.length} incomplete of ${days.length} in the corpus)`),
  );
};

// Chain comparison: score each chain on the intersection of the common basket
// it actually prices (show coverage), never raw totals across unequal baskets.
function buildChains(
  latest: LoadedDay,
  commonBasket: number[],
  muniSetts: Map<string, string[]>,
  rankByCode: Map<string, Record<string, unknown>>,
  basketCap: Map<number, number>,
  emit: Emit,
): void {
  const chainNames = latest.grid.chainNames;
  // national: eik -> pid -> median over settlements of that chain's min
  const natChainPid = chainPidValues(
    latest.grid.chainCells,
    Object.keys(latest.grid.chainCells),
  );
  // median + r2 reuse the module-level helpers (no local shadows)
  const chainBasket = (m: Map<number, number[]>) => {
    let total = 0;
    let nPriced = 0;
    for (const g of commonBasket) {
      const cap = basketCap.get(g);
      const arr = m.get(g)?.filter((v) => cap == null || v <= cap);
      if (arr && arr.length) {
        const v = median(arr);
        total += v;
        nPriced++;
      }
    }
    return { basket: r2(total), nPriced };
  };
  const national = [...natChainPid.entries()]
    .map(([eik, m]) => {
      const { basket, nPriced } = chainBasket(m);
      return {
        eik,
        chain: chainNames[eik] ?? eik,
        basket,
        nPriced,
        // Whether this row may be RANKED against the others. `basket` is a sum
        // over the subset the chain actually priced, so a chain missing items
        // has a smaller number without being a cheaper shop — measured on the
        // 2026-08 corpus, the four "cheapest chains" priced 8, 7, 10 and 8 of
        // 12, and on the full basket the order is completely different (ЖИЗЕЛ
        // 14.47, Лидл 14.50, BulMag 15.25, none of which appeared).
        //
        // It is a FIELD rather than a rule each consumer applies because the
        // consumers are not all TypeScript: /api/db/company ranks these rows in
        // SQL and the AI chat answers from them in prose. Seven surfaces read
        // this payload; a helper could only ever reach five.
        comparable: nPriced >= commonBasket.length,
        products: m.size,
      };
    })
    .filter((c) => c.nPriced >= 0.5 * commonBasket.length)
    .sort((a, b) => a.basket - b.basket || (a.eik < b.eik ? -1 : 1));

  emit("chains", "", {
    latestDate: latest.date,
    commonBasketSize: commonBasket.length,
    note: "Chains scored on the common basket they price (nPriced of commonBasketSize). `basket` is a SUM over that subset, so rows are comparable only when `comparable` is true (nPriced = commonBasketSize) — a partial basket is a smaller number, not a cheaper shop. Rank on comparable rows; show the rest with their coverage.",
    national,
  });

  // per-muni
  for (const [obsht, eks] of muniSetts) {
    const muniChainPid = chainPidValues(latest.grid.chainCells, eks);
    const chains = [...muniChainPid.entries()]
      .map(([eik, m]) => {
        const { basket, nPriced } = chainBasket(m);
        return {
          eik,
          chain: chainNames[eik] ?? eik,
          basket,
          nPriced,
          comparable: nPriced >= commonBasket.length,
        };
      })
      // Fairness: only rank chains pricing ≥half the core basket, so a kiosk
      // pricing 3 staples can't masquerade as "cheapest". nPriced is shipped
      // so the UI shows coverage.
      .filter((c) => c.nPriced >= 0.5 * commonBasket.length)
      .sort((a, b) => a.basket - b.basket || (a.eik < b.eik ? -1 : 1));
    // Write a município shard whenever the muni has chains OR a rank row, so the
    // place dashboard can read its muni rank + chains from one small file.
    const rank = rankByCode.get(obsht) ?? null;
    if (chains.length || rank)
      emit("chains-muni", obsht, {
        obshtina: obsht,
        latestDate: latest.date,
        coreBasketSize: commonBasket.length,
        rank,
        chains,
      });
  }
}

if (process.argv[1] && /build_index\.ts$/.test(process.argv[1])) {
  buildPriceIndex();
}
