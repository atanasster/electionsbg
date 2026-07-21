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
import { median } from "@/lib/awarderModel";

export interface CorpusUnitCost {
  /** Median €/km across the defensible member road contracts (robust to the
   *  occasional scope-mismatched outlier the gate lets through). */
  eurPerKmMedian: number;
  /** How many member contracts carried a defensible €/km (the evidence base). */
  sampleCount: number;
  /** Σ parsed length (km) across those contracts. */
  totalKm: number;
  /** Σ contracted value (EUR) of those contracts — the money the €/km is over. */
  contractedInSampleEur: number;
}

type RoadRow = Pick<ProcurementContract, "title" | "cpv" | "amountEur" | "tag">;

/**
 * The corpus €/km cross-check for a roads file, or null when the evidence base is
 * thinner than `minSamples` (too few defensible rows to publish a unit cost).
 * Pure + deterministic: same members → same figure. Award rows and amendments
 * (tag !== "contract") are ignored so the €/km is over signed contract values only.
 */
export function computeCorpusEurPerKm(
  contracts: ReadonlyArray<RoadRow>,
  minSamples = 3,
): CorpusUnitCost | null {
  const perKm: number[] = [];
  let totalKm = 0;
  let contractedInSampleEur = 0;
  for (const c of contracts) {
    if ((c.tag ?? "contract") !== "contract") continue;
    const workType = workTypeOf(c.title ?? "", c.cpv ?? undefined);
    const len = lengthOf(c.title ?? "");
    // eurPerKmOf reads only amountEur — its parameter is now that minimal shape.
    const pk = eurPerKmOf({ amountEur: c.amountEur }, workType, len);
    if (!pk) continue;
    perKm.push(pk.eurPerKm);
    totalKm += pk.lengthKm;
    contractedInSampleEur += c.amountEur ?? 0;
  }
  if (perKm.length < minSamples) return null;
  // Reuse the canonical median (@/lib/awarderModel) the roads engine uses, so the
  // statistic stays defined in one place (odd → middle, even → mean of the two).
  return {
    eurPerKmMedian: median(perKm),
    sampleCount: perKm.length,
    totalKm,
    contractedInSampleEur,
  };
}
