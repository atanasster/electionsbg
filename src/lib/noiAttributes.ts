// НОИ (ДОО) procurement classification engine — the pure, dependency-free core
// of the НОИ sector pack, mirroring roadAttributes for the road pack. It takes
// the buyer's per-contract rows (already scope-windowed by the host) and folds
// them into an НОИ-legible model: functional categories of spend (the pension
// IT backbone, postal/pension-delivery, the ТП building stock…), supplier
// dependence, competition (single-bid / direct-award) and a yearly spine.
//
// No React, no i18n, no fetching — labels and reference levels live in
// noiBenchmarks; this file is just aggregation so it stays trivially testable.

import { categoryOfCpv, NOI_EIK, type NoiCategory } from "./noiBenchmarks";
import { procedureBucket } from "./cpvSectors";

export { NOI_EIK };

// A minimal structural view of a procurement row — the subset the engine reads,
// so it accepts both the DB ProcurementContract and any lighter shape.
export interface NoiContractRow {
  tag?: string;
  date?: string;
  contractorEik?: string;
  contractorName?: string;
  amountEur?: number;
  cpv?: string;
  procurementMethod?: string;
  numberOfTenderers?: number;
}

export interface NoiSupplier {
  eik: string;
  name: string;
  totalEur: number;
  contractCount: number;
  category: NoiCategory; // dominant category by € for this supplier
  /** Share of this supplier's bid-known contracts that were single-bid; null
   *  when none of its contracts carry a tenderer count. */
  singleBidShare: number | null;
  bidKnownN: number;
}

export interface NoiCategoryAgg {
  id: NoiCategory;
  totalEur: number;
  contractCount: number;
  supplierCount: number;
  singleBidShare: number | null;
  bidKnownN: number;
  topSupplier: { eik: string; name: string; totalEur: number } | null;
}

export interface NoiYear {
  year: number;
  totalEur: number;
  contractCount: number;
  byCategory: Partial<Record<NoiCategory, number>>;
}

export interface NoiModel {
  totalEur: number;
  contractCount: number;
  supplierCount: number;
  // Competition — computed the competitive-only way the national benchmark uses
  // (single-bid denominator is bid-known contracts; direct = "no call" bucket).
  bidKnownN: number;
  singleBidN: number;
  singleBidShare: number | null;
  directEur: number;
  directShare: number;
  categories: NoiCategoryAgg[]; // sorted by € desc, "other" always last
  suppliers: NoiSupplier[]; // sorted by € desc
  years: NoiYear[]; // ascending
  minYear: number | null;
  maxYear: number | null;
}

const yearOf = (date: string | undefined): number | null => {
  const y = Number(String(date ?? "").slice(0, 4));
  return Number.isFinite(y) && y > 1990 ? y : null;
};

const CATEGORY_ORDER: NoiCategory[] = [
  "it",
  "comms",
  "buildings",
  "energy",
  "services",
  "other",
];

/** Build the НОИ model from already-windowed rows. Only tag='contract' rows
 *  carry money (awards/amendments would double-count), matching the awarder
 *  rollup on the host page. */
export const buildNoiModel = (rows: NoiContractRow[]): NoiModel => {
  const contracts = rows.filter((r) => r.tag === "contract");

  let totalEur = 0;
  let bidKnownN = 0;
  let singleBidN = 0;
  let directEur = 0;

  // Per-supplier accumulation (with per-category € so we can pick a dominant
  // category and, per category, a top supplier).
  interface SupAcc {
    eik: string;
    name: string;
    totalEur: number;
    contractCount: number;
    bidKnownN: number;
    singleBidN: number;
    byCat: Map<NoiCategory, number>;
  }
  const sup = new Map<string, SupAcc>();

  interface CatAcc {
    totalEur: number;
    contractCount: number;
    bidKnownN: number;
    singleBidN: number;
    suppliers: Set<string>;
  }
  const cat = new Map<NoiCategory, CatAcc>();

  const yearMap = new Map<number, NoiYear>();

  for (const c of contracts) {
    const eur = c.amountEur ?? 0;
    const category = categoryOfCpv(c.cpv);
    totalEur += eur;

    const known = c.numberOfTenderers != null;
    const single = known && (c.numberOfTenderers as number) <= 1;
    if (known) bidKnownN += 1;
    if (single) singleBidN += 1;
    if (procedureBucket(c.procurementMethod) === "direct") directEur += eur;

    // category rollup
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

    // supplier rollup
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

      // year spine
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

  const suppliers: NoiSupplier[] = [...sup.values()]
    .map((s) => {
      let dom: NoiCategory = "other";
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
        category: dom,
        singleBidShare: s.bidKnownN > 0 ? s.singleBidN / s.bidKnownN : null,
        bidKnownN: s.bidKnownN,
      };
    })
    .sort((a, b) => b.totalEur - a.totalEur);

  const topSupplierOf = (
    category: NoiCategory,
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

  const categories: NoiCategoryAgg[] = [...cat.entries()]
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
      // "other" always sinks to the bottom; the rest by € desc.
      if (x.id === "other" && y.id !== "other") return 1;
      if (y.id === "other" && x.id !== "other") return -1;
      return y.totalEur - x.totalEur;
    });

  const years = [...yearMap.values()].sort((a, b) => a.year - b.year);

  return {
    totalEur,
    contractCount: contracts.length,
    supplierCount: sup.size,
    bidKnownN,
    singleBidN,
    singleBidShare: bidKnownN > 0 ? singleBidN / bidKnownN : null,
    directEur,
    directShare: totalEur > 0 ? directEur / totalEur : 0,
    categories,
    suppliers,
    years,
    minYear: years.length ? years[0].year : null,
    maxYear: years.length ? years[years.length - 1].year : null,
  };
};

// Keep CATEGORY_ORDER referenced (stable category iteration for consumers that
// want a fixed sequence, e.g. the stacked year spine legend).
export const NOI_CATEGORY_ORDER = CATEGORY_ORDER;
