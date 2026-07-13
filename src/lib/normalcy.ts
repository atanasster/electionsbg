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

/** Classify one metric by where its value falls in the cohort.
 *  `percentile` = share of the cohort strictly below the value (0..1). */
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

/** The three cohort metrics that carry a risk direction (procedure is
 *  categorical and handled separately). Returns each with its verdict, skipping
 *  absent metrics. */
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

/** How many metrics deviate toward weaker competition, and how many were
 *  evaluable — the soft summary line ("2 of 4 deviate"). Procedure counts as a
 *  deviation when this contract is non-open in a cohort that's mostly open. */
export const normalcyDeviationSummary = (
  data: ContractNormalcy,
): { deviations: number; evaluated: number } => {
  const verdicts = normalcyMetricVerdicts(data);
  let deviations = verdicts.filter((v) => v.verdict.isRiskDeviation).length;
  let evaluated = verdicts.filter(
    (v) => v.verdict.level !== "insufficient",
  ).length;
  if (data.procedure && data.procedure.n >= NORMALCY_MIN_N) {
    evaluated += 1;
    // Non-open in a cohort where open is the clear majority (>60%) is a
    // procedure-choice deviation.
    if (!data.procedure.isOpen && data.procedure.openShare > 0.6)
      deviations += 1;
  }
  return { deviations, evaluated };
};
