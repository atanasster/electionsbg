// Corpus-derived €/km cross-check for a roads project file (§10 Phase 3, §49–52).
//
// A curated `benchmark` range is editorial; this is its evidence-side counterpart —
// a €/km figure computed from the file's OWN road member contracts, so the honesty
// block can show "договорено €X · извлечена единична цена €Y/км" without inventing a
// comparator. It reuses roadAttributes' defensibility gate verbatim (workType +
// parseable 0.5–50 km length + per-km floor), so only rows that legitimately carry a
// €/km count — per the roads-effectiveness audit only ~7% of road rows do, so this is
// often null, which the caller renders as "absent", never as zero.

import {
  workTypeOf,
  workTypeInProcedure,
  noiseBarrierUnps,
  lengthOf,
  eurPerKmOf,
} from "@/lib/roadAttributes";

export interface CorpusUnitCost {
  /** VALUE-WEIGHTED median €/km — the rate at which half the sample's MONEY sits
   *  below. The workType gate now drops archaeology / supervision / design rows
   *  (roadAttributes.workTypeOf), but small physical lots that span km yet carry
   *  little value still exist; weighting by contracted value lets the big
   *  construction contracts — where the money actually is — set the figure, so
   *  it reads as the real cost of building the road per km. */
  eurPerKmMedian: number;
  /** How many member contracts carried a defensible €/km (the evidence base). */
  sampleCount: number;
  /** Σ parsed length (km) across those contracts. */
  totalKm: number;
  /** Σ contracted value (EUR) of those contracts — the money the €/km is over. */
  contractedInSampleEur: number;
}

// Minimal, defensively-nullable shape: the body already tolerates missing
// title/cpv/amountEur/tag, so this accepts both a full ProcurementContract and
// the leaner CRow the dossier resolver emits (nullable fields), which the
// Pick<ProcurementContract, …> form rejected (its title/tag are non-null).
type RoadRow = {
  title?: string | null;
  cpv?: string | null;
  contractorName?: string | null;
  unp?: string | null;
  amountEur?: number | null;
  tag?: string | null;
};

/** Value-weighted median of (€/km, value) pairs — the lowest €/km at or below
 *  which at least half the total weight (money) sits (the LOWER weighted median).
 *  Sorted ascending; returns the first point whose cumulative weight reaches
 *  `total/2`, so an exact even money split resolves to the lower rate. */
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
  const noiseUnps = noiseBarrierUnps(contracts);
  for (const c of contracts) {
    if ((c.tag ?? "contract") !== "contract") continue;
    const workType = workTypeInProcedure(
      workTypeOf(
        c.title ?? "",
        c.cpv ?? undefined,
        c.contractorName ?? undefined,
      ),
      c.unp,
      noiseUnps,
    );
    const len = lengthOf(c.title ?? "");
    // eurPerKmOf reads only amountEur + title — its parameter is that minimal shape.
    const pk = eurPerKmOf(
      { amountEur: c.amountEur ?? undefined, title: c.title },
      workType,
      len,
    );
    if (!pk) continue;
    const weight = c.amountEur ?? 0;
    // eurPerKmOf's amount floor makes this unreachable, but keep the positive-weight
    // invariant local + explicit so a future gate change can't reintroduce a 0 rate.
    if (weight <= 0) continue;
    pairs.push({ perKm: pk.eurPerKm, weight });
    totalKm += pk.lengthKm;
    contractedInSampleEur += weight;
  }
  if (pairs.length < minSamples) return null;
  return {
    eurPerKmMedian: weightedMedian(pairs),
    sampleCount: pairs.length,
    totalKm,
    contractedInSampleEur,
  };
}
