// Corpus-derived €/km cross-check for a roads project file (§10 Phase 3, §49–52).
//
// A curated `benchmark` range is editorial; this is its evidence-side counterpart —
// a €/km figure computed from the file's OWN road member contracts, so the honesty
// block can show "договорено €X · извлечена единична цена €Y/км" without inventing a
// comparator. It reuses roadAttributes' defensibility gate verbatim (workType +
// parseable 0.5–50 km length + per-km floor), so only rows that legitimately carry a
// €/km count — per the roads-effectiveness audit only ~7% of road rows do, so this is
// often null, which the caller renders as "absent", never as zero.

import type { ProcurementContract } from "@/data/dataTypes";
import { workTypeOf, lengthOf, eurPerKmOf } from "@/lib/roadAttributes";

export interface CorpusUnitCost {
  /** VALUE-WEIGHTED median €/km — the rate at which half the sample's MONEY sits
   *  below. A plain per-contract median is dragged down by the many cheap survey /
   *  archaeology contracts that each span km but carry little value (and which the
   *  workType gate misclassifies as physical works); weighting by contracted value
   *  lets the big construction contracts — where the money actually is — set the
   *  figure, so it reads as the real cost of building the road per km. */
  eurPerKmMedian: number;
  /** How many member contracts carried a defensible €/km (the evidence base). */
  sampleCount: number;
  /** Σ parsed length (km) across those contracts. */
  totalKm: number;
  /** Σ contracted value (EUR) of those contracts — the money the €/km is over. */
  contractedInSampleEur: number;
}

type RoadRow = Pick<ProcurementContract, "title" | "cpv" | "amountEur" | "tag">;

/** Value-weighted median of (€/km, value) pairs — the €/km below which half the
 *  total weight (money) lies. Sorted ascending; returns the first point whose
 *  cumulative weight reaches half. */
const weightedMedian = (
  pairs: ReadonlyArray<{ perKm: number; weight: number }>,
): number => {
  const sorted = pairs
    .filter((p) => p.weight > 0)
    .sort((a, b) => a.perKm - b.perKm);
  if (!sorted.length) return 0;
  const total = sorted.reduce((s, p) => s + p.weight, 0);
  let cum = 0;
  for (const p of sorted) {
    cum += p.weight;
    if (cum >= total / 2) return p.perKm;
  }
  return sorted[sorted.length - 1].perKm;
};

/**
 * The corpus €/km cross-check for a roads file, or null when the evidence base is
 * thinner than `minSamples` (too few defensible rows to publish a unit cost).
 * Pure + deterministic: same members → same figure. Award rows and amendments
 * (tag !== "contract") are ignored so the €/km is over signed contract values only.
 * The rate is VALUE-WEIGHTED (see CorpusUnitCost.eurPerKmMedian).
 */
export function computeCorpusEurPerKm(
  contracts: ReadonlyArray<RoadRow>,
  minSamples = 3,
): CorpusUnitCost | null {
  const pairs: { perKm: number; weight: number }[] = [];
  let totalKm = 0;
  let contractedInSampleEur = 0;
  for (const c of contracts) {
    if ((c.tag ?? "contract") !== "contract") continue;
    const workType = workTypeOf(c.title ?? "", c.cpv ?? undefined);
    const len = lengthOf(c.title ?? "");
    // eurPerKmOf reads only amountEur — its parameter is now that minimal shape.
    const pk = eurPerKmOf({ amountEur: c.amountEur }, workType, len);
    if (!pk) continue;
    pairs.push({ perKm: pk.eurPerKm, weight: c.amountEur ?? 0 });
    totalKm += pk.lengthKm;
    contractedInSampleEur += c.amountEur ?? 0;
  }
  if (pairs.length < minSamples) return null;
  return {
    eurPerKmMedian: weightedMedian(pairs),
    sampleCount: pairs.length,
    totalKm,
    contractedInSampleEur,
  };
}
