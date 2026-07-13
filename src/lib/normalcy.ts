// Verdict logic for the "how normal is this procurement?" panel — pure and
// React-free so the panel UI and the AI narration tool read a metric the same
// way. It turns a cohort percentile + risk direction into a positional verdict.
//
// The cardinal rule: this is DESCRIPTIVE. A "deviation" means the value sits in
// the risk tail of its cohort, nothing more — never a finding of wrongdoing.
// Neutral metrics (value) never count as a deviation, however extreme.

import type {
  ContractNormalcy,
  NormalcyDir,
  NormalcyProcedure,
} from "@/data/procurement/useContractNormalcy";

/** Below this cohort size a percentile is too noisy to read a verdict from — the
 *  strip still renders, but the metric neither claims a verdict nor counts toward
 *  the deviation summary. */
export const NORMALCY_MIN_N = 20;

export type NormalcyLevel = "typical" | "notable" | "unusual" | "insufficient";

export type NormalcyVerdict = {
  level: NormalcyLevel;
  /** Sits in the risk tail (counts toward the "N of M deviate" summary). */
  isRiskDeviation: boolean;
};

/**
 * Classify one metric by where its value falls in its cohort.
 *
 * @param percentile share of the cohort strictly below the value (0..1), or null
 *   when the metric is absent.
 * @param dir risk direction — `"low"` (few bidders = weaker competition),
 *   `"high"` (supplier over-concentration), or `"neutral"` (value: informative
 *   but never a deviation).
 * @param n cohort size for this metric; below {@link NORMALCY_MIN_N} the reading
 *   is `"insufficient"` regardless of percentile.
 * @returns the positional {@link NormalcyLevel} and whether it sits in the risk
 *   tail. A `"neutral"` metric is never an `isRiskDeviation`, however extreme.
 */
export const normalcyVerdict = (
  percentile: number | null | undefined,
  dir: NormalcyDir,
  n: number,
): NormalcyVerdict => {
  if (percentile == null || n < NORMALCY_MIN_N)
    return { level: "insufficient", isRiskDeviation: false };

  if (dir === "neutral") {
    const level =
      percentile >= 0.25 && percentile <= 0.75 ? "typical" : "notable";
    return { level, isRiskDeviation: false };
  }
  if (dir === "low") {
    // Low value = weaker competition (few bidders). Risk tail is the bottom.
    if (percentile <= 0.1) return { level: "unusual", isRiskDeviation: true };
    if (percentile <= 0.25) return { level: "notable", isRiskDeviation: false };
    return { level: "typical", isRiskDeviation: false };
  }
  // dir === "high": high value = risk (over-concentration). Risk tail is the top.
  if (percentile >= 0.9) return { level: "unusual", isRiskDeviation: true };
  if (percentile >= 0.75) return { level: "notable", isRiskDeviation: false };
  return { level: "typical", isRiskDeviation: false };
};

/** Whether the procedure metric has enough cohort rows to read (mirrors the
 *  {@link NORMALCY_MIN_N} gate the numeric metrics get inside {@link normalcyVerdict}). */
export const procedureEvaluable = (p: NormalcyProcedure): boolean =>
  p.n >= NORMALCY_MIN_N;

/** Whether this contract's procedure is a deviation toward weaker competition —
 *  a non-open procedure in a cohort where open is the clear majority (>60%).
 *  The single source of truth for the panel chip, the AI verdict, and the
 *  deviation count, so the three can never drift. Only true when evaluable. */
export const procedureIsDeviation = (p: NormalcyProcedure): boolean =>
  procedureEvaluable(p) && !p.isOpen && p.openShare > 0.6;

/** The three cohort metrics that carry a risk direction (procedure is
 *  categorical and handled separately). Returns each with its verdict, skipping
 *  absent metrics.
 *
 *  @returns one entry per present metric, in a fixed order (value, bidders,
 *    concentration), each with its {@link NormalcyVerdict}. */
export const normalcyMetricVerdicts = (
  data: ContractNormalcy,
): Array<{
  key: "value" | "bidders" | "concentration";
  verdict: NormalcyVerdict;
}> => {
  const out: Array<{
    key: "value" | "bidders" | "concentration";
    verdict: NormalcyVerdict;
  }> = [];
  if (data.value)
    out.push({
      key: "value",
      verdict: normalcyVerdict(data.value.percentile, "neutral", data.value.n),
    });
  if (data.bidders)
    out.push({
      key: "bidders",
      verdict: normalcyVerdict(data.bidders.percentile, "low", data.bidders.n),
    });
  if (data.concentration)
    out.push({
      key: "concentration",
      verdict: normalcyVerdict(
        data.concentration.percentile,
        "high",
        data.concentration.peerN,
      ),
    });
  return out;
};

/**
 * The soft summary line ("2 of 4 indicators deviate").
 *
 * @returns `deviations` = risk-directional metrics (bidders / concentration /
 *   procedure) sitting in their risk tail; `evaluated` = risk-directional
 *   metrics with enough cohort data to read (>= {@link NORMALCY_MIN_N}). The
 *   neutral `value` metric is deliberately excluded from BOTH — it can never
 *   deviate, so counting it in the denominator would let a value-only cohort
 *   read as a false "no deviations" all-clear. Callers should hide the summary
 *   badge when `evaluated === 0` (no competition signal was assessable).
 * @example
 *   // bidders in the bottom decile, concentration typical, no procedure data:
 *   normalcyDeviationSummary(data); // => { deviations: 1, evaluated: 2 }
 */
export const normalcyDeviationSummary = (
  data: ContractNormalcy,
): { deviations: number; evaluated: number } => {
  // Only risk-directional metrics count — the neutral `value` is excluded so the
  // denominator reflects competition signals actually assessed (FINDING-002).
  const riskVerdicts = normalcyMetricVerdicts(data).filter(
    (v) => v.key !== "value",
  );
  let deviations = riskVerdicts.filter((v) => v.verdict.isRiskDeviation).length;
  let evaluated = riskVerdicts.filter(
    (v) => v.verdict.level !== "insufficient",
  ).length;
  if (data.procedure && procedureEvaluable(data.procedure)) {
    evaluated += 1;
    if (procedureIsDeviation(data.procedure)) deviations += 1;
  }
  return { deviations, evaluated };
};
