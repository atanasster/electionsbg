import type { CensusMetric } from "@/data/census/censusTypes";
import type { DemographicCleavagesPayload } from "@/data/dashboard/useDemographicCleavages";

export type CleavageKpis = {
  /** The most polarizing dimension — the highest-spread row (payload rows are
   *  pre-sorted by spread desc at build time, so this is rows[0]). */
  top: { metric: CensusMetric; spread: number };
  /** The single sharpest party×metric correlation across the whole matrix. */
  best: { r: number; metric: CensusMetric; partyIdx: number };
};

/** Headline figures for the /party-demographics page, derived from the
 *  cleavages payload. Returns undefined when there are no rows. Pure — no React,
 *  so it's unit-testable in isolation. */
export const computeCleavageKpis = (
  payload: DemographicCleavagesPayload | undefined,
): CleavageKpis | undefined => {
  if (!payload || payload.rows.length === 0) return undefined;
  const top = payload.rows[0];
  // Seed from the first real cell so an all-zero payload still reports a real
  // (party, metric) rather than a synthetic +0.00 against parties[0].
  let best = { r: top.rs[0] ?? 0, metric: top.metric, partyIdx: 0 };
  for (const row of payload.rows) {
    row.rs.forEach((r, i) => {
      if (Math.abs(r) > Math.abs(best.r))
        best = { r, metric: row.metric, partyIdx: i };
    });
  }
  return { top: { metric: top.metric, spread: top.spread }, best };
};
