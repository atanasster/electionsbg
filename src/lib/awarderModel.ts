// Shared, buyer-agnostic procurement aggregation — the generic core the sector
// engines build on. It owns the *canonical* rules (what counts as a spend row,
// single-bid, direct-award) so roads, НОИ and any future pack can't drift on
// them, plus a generic classify-and-aggregate (`buildAwarderModel`) that a pack
// whose only geometry is "spend by category / supplier / year" uses wholesale.
//
// Roads keeps its own bespoke engine (corridors, chainage, €/km, components) —
// that geometry is genuinely road-specific, not duplication — but pulls its
// median/quantile and its headline competition block from here so the numbers
// are defined in exactly one place. НОИ IS a `buildAwarderModel` call.

import type { ProcurementContract } from "@/data/dataTypes";
import { procedureBucket } from "@/lib/cpvSectors";

// --- Canonical row predicates ----------------------------------------------

/** Amendments re-state an existing contract's value (see rollups.ts) — never a
 *  spend row. `contractsOnly` further drops bare `award` rows, matching the
 *  awarder rollup the host page shows (tag='contract'); roads counts awards too
 *  (its historical behaviour), so it leaves this false. */
export const isSpendRow = (
  c: { tag?: string },
  contractsOnly = false,
): boolean =>
  contractsOnly ? c.tag === "contract" : c.tag !== "contractAmendment";

/** Exactly one tenderer — the single-bid rule used across the DB functions
 *  (011/023/033/041) and the roads engine. `null` tenderer count ⇒ not counted
 *  (bid data unknown), NOT counted as single-bid. */
export const isSingleBid = (numberOfTenderers: number | null | undefined) =>
  numberOfTenderers === 1;

// --- Small stats helpers (shared with the roads €/km tiles) -----------------

export const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const quantile = (xs: number[], q: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// --- Competition / total stats ---------------------------------------------

export interface CompetitionStats {
  totalEur: number;
  contractCount: number;
  /** Rows carrying a tenderer count (the single-bid denominator). */
  bidKnownN: number;
  singleBidN: number;
  /** singleBidN / bidKnownN, or null when no row carries a bid count. */
  singleBidShare: number | null;
  /** € awarded via direct / no-notice procedures. */
  directEur: number;
  directShare: number;
}

/** Canonical competition + total roll-up over a set of already-filtered spend
 *  rows. The caller decides the row filter (roads: non-amendment; НОИ:
 *  contracts-only) — this only counts what it is given. */
export const competitionStats = (
  rows: {
    amountEur?: number;
    numberOfTenderers?: number | null;
    procurementMethod?: string;
  }[],
): CompetitionStats => {
  let totalEur = 0;
  let bidKnownN = 0;
  let singleBidN = 0;
  let directEur = 0;
  for (const r of rows) {
    const eur = r.amountEur ?? 0;
    totalEur += eur;
    if (r.numberOfTenderers != null) {
      bidKnownN += 1;
      if (isSingleBid(r.numberOfTenderers)) singleBidN += 1;
    }
    if (procedureBucket(r.procurementMethod) === "direct") directEur += eur;
  }
  return {
    totalEur,
    contractCount: rows.length,
    bidKnownN,
    singleBidN,
    singleBidShare: bidKnownN > 0 ? singleBidN / bidKnownN : null,
    directEur,
    directShare: totalEur > 0 ? directEur / totalEur : 0,
  };
};

// --- Generic classify-and-aggregate model -----------------------------------

/** Maps a contract to a category id + declares category ordering. `order`
 *  lists the leading categories in display order; the rest sort by € desc after
 *  them, and `sink` (e.g. "other") always sorts last. */
export interface SectorClassifier<Cat extends string> {
  categoryOf: (c: ProcurementContract) => Cat;
  order?: readonly Cat[];
  sink?: Cat;
}

export interface AwarderSupplier<Cat extends string> {
  eik: string;
  name: string;
  totalEur: number;
  contractCount: number;
  /** Dominant category by € for this supplier. */
  category: Cat;
  singleBidShare: number | null;
  bidKnownN: number;
}

export interface AwarderCategoryAgg<Cat extends string> {
  id: Cat;
  totalEur: number;
  contractCount: number;
  supplierCount: number;
  singleBidShare: number | null;
  bidKnownN: number;
  topSupplier: { eik: string; name: string; totalEur: number } | null;
}

export interface AwarderYear<Cat extends string> {
  year: number;
  totalEur: number;
  contractCount: number;
  byCategory: Partial<Record<Cat, number>>;
}

export interface AwarderModel<Cat extends string> extends CompetitionStats {
  supplierCount: number;
  categories: AwarderCategoryAgg<Cat>[]; // sorted per classifier.order, sink last
  suppliers: AwarderSupplier<Cat>[]; // sorted by € desc
  years: AwarderYear<Cat>[]; // ascending
  minYear: number | null;
  maxYear: number | null;
}

const yearOf = (date: string | undefined): number | null => {
  const y = Number(String(date ?? "").slice(0, 4));
  return Number.isFinite(y) && y > 1990 ? y : null;
};

/** Build the generic per-category / per-supplier / per-year model from
 *  already-filtered spend rows. */
export const buildAwarderModel = <Cat extends string>(
  rows: ProcurementContract[],
  classifier: SectorClassifier<Cat>,
): AwarderModel<Cat> => {
  const stats = competitionStats(rows);

  interface SupAcc {
    eik: string;
    name: string;
    totalEur: number;
    contractCount: number;
    bidKnownN: number;
    singleBidN: number;
    byCat: Map<Cat, number>;
  }
  const sup = new Map<string, SupAcc>();

  interface CatAcc {
    totalEur: number;
    contractCount: number;
    bidKnownN: number;
    singleBidN: number;
    suppliers: Set<string>;
  }
  const cat = new Map<Cat, CatAcc>();
  const yearMap = new Map<number, AwarderYear<Cat>>();

  for (const c of rows) {
    const eur = c.amountEur ?? 0;
    const category = classifier.categoryOf(c);
    const known = c.numberOfTenderers != null;
    const single = known && isSingleBid(c.numberOfTenderers);

    let ca = cat.get(category);
    if (!ca) {
      ca = {
        totalEur: 0,
        contractCount: 0,
        bidKnownN: 0,
        singleBidN: 0,
        suppliers: new Set(),
      };
      cat.set(category, ca);
    }
    ca.totalEur += eur;
    ca.contractCount += 1;
    if (known) ca.bidKnownN += 1;
    if (single) ca.singleBidN += 1;

    const eik = c.contractorEik;
    if (eik) {
      ca.suppliers.add(eik);
      let s = sup.get(eik);
      if (!s) {
        s = {
          eik,
          name: c.contractorName || `ЕИК ${eik}`,
          totalEur: 0,
          contractCount: 0,
          bidKnownN: 0,
          singleBidN: 0,
          byCat: new Map(),
        };
        sup.set(eik, s);
      }
      s.totalEur += eur;
      s.contractCount += 1;
      if (known) s.bidKnownN += 1;
      if (single) s.singleBidN += 1;
      s.byCat.set(category, (s.byCat.get(category) ?? 0) + eur);

      const y = yearOf(c.date);
      if (y != null) {
        let yr = yearMap.get(y);
        if (!yr) {
          yr = { year: y, totalEur: 0, contractCount: 0, byCategory: {} };
          yearMap.set(y, yr);
        }
        yr.totalEur += eur;
        yr.contractCount += 1;
        yr.byCategory[category] = (yr.byCategory[category] ?? 0) + eur;
      }
    }
  }

  const suppliers: AwarderSupplier<Cat>[] = [...sup.values()]
    .map((s) => {
      let dom: Cat | null = null;
      let domEur = -1;
      for (const [k, v] of s.byCat) {
        if (v > domEur) {
          domEur = v;
          dom = k;
        }
      }
      return {
        eik: s.eik,
        name: s.name,
        totalEur: s.totalEur,
        contractCount: s.contractCount,
        category: dom ?? classifier.sink ?? ([...s.byCat.keys()][0] as Cat),
        singleBidShare: s.bidKnownN > 0 ? s.singleBidN / s.bidKnownN : null,
        bidKnownN: s.bidKnownN,
      };
    })
    .sort((a, b) => b.totalEur - a.totalEur);

  const topSupplierOf = (
    category: Cat,
  ): { eik: string; name: string; totalEur: number } | null => {
    let best: { eik: string; name: string; totalEur: number } | null = null;
    for (const s of sup.values()) {
      const e = s.byCat.get(category);
      if (e == null) continue;
      if (!best || e > best.totalEur)
        best = { eik: s.eik, name: s.name, totalEur: e };
    }
    return best;
  };

  const orderIndex = (id: Cat): number => {
    const i = classifier.order?.indexOf(id) ?? -1;
    return i >= 0 ? i : Number.MAX_SAFE_INTEGER - 1;
  };
  const categories: AwarderCategoryAgg<Cat>[] = [...cat.entries()]
    .map(([id, a]) => ({
      id,
      totalEur: a.totalEur,
      contractCount: a.contractCount,
      supplierCount: a.suppliers.size,
      singleBidShare: a.bidKnownN > 0 ? a.singleBidN / a.bidKnownN : null,
      bidKnownN: a.bidKnownN,
      topSupplier: topSupplierOf(id),
    }))
    .sort((x, y) => {
      // sink (e.g. "other") always last; then declared order; then € desc.
      const xs = classifier.sink != null && x.id === classifier.sink;
      const ys = classifier.sink != null && y.id === classifier.sink;
      if (xs !== ys) return xs ? 1 : -1;
      const oi = orderIndex(x.id) - orderIndex(y.id);
      if (oi !== 0) return oi;
      return y.totalEur - x.totalEur;
    });

  const years = [...yearMap.values()].sort((a, b) => a.year - b.year);

  return {
    ...stats,
    supplierCount: sup.size,
    categories,
    suppliers,
    years,
    minYear: years.length ? years[0].year : null,
    maxYear: years.length ? years[years.length - 1].year : null,
  };
};
