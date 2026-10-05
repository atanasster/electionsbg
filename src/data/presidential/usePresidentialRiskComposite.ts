// React adapter for the presidential Election Risk Index: wires the round's section risk score,
// flash comparison, suspicious-settlement flags and the agencies' round-one poll errors into
// `computePresidentialRiskComposite`.
//
// ⚠ THE RISK SCORE IS THE ONLY REQUIRED INPUT. Flash is absent for every cycle but 2021 and the
// settlement flags may be absent too; each missing input makes its components unavailable rather
// than holding the whole index back. A missing risk score means there is no index at all.

import { useMemo } from "react";
import type { RiskComposite } from "@/data/riskScore/computeRiskComposite";
import { usePresidentialPollsAccuracy } from "./usePresidentialPolls";
import { useFlashDiffQuery } from "./useFlashDiff";
import { usePresidentialSuspicious } from "./useSuspiciousSettlements";
import {
  usePresidentialRiskScore,
  type PresidentialRiskScoreState,
} from "./useRiskScore";
import { computePresidentialRiskComposite } from "./presidentialRiskComposite";

export type PresidentialRiskIndexState =
  | { status: "loading" }
  | {
      status: "ready";
      composite: RiskComposite | null;
      risk: Extract<PresidentialRiskScoreState, { status: "ready" }>["risk"];
    }
  | { status: "absent" }
  | { status: "unusable" };

export const usePresidentialRiskIndex = (
  cycle: string,
  round: 1 | 2,
): PresidentialRiskIndexState => {
  const risk = usePresidentialRiskScore(cycle, round);
  const flash = useFlashDiffQuery(cycle, round);
  const suspicious = usePresidentialSuspicious(cycle, round);
  const polls = usePresidentialPollsAccuracy();

  return useMemo<PresidentialRiskIndexState>(() => {
    if (risk.status !== "ready") return risk;
    // Hold the index until the optional inputs have SETTLED, so it never renders once without
    // them and then jumps — the parliamentary hook's coherence rule.
    if (suspicious.status === "loading" || polls.isPending || flash.isPending)
      return { status: "loading" };
    const pollMaes =
      polls.data?.cycles
        .find((c) => c.cycle === cycle)
        ?.agencies.map((a) => a.mae) ?? [];
    return {
      status: "ready",
      risk: risk.risk,
      composite: computePresidentialRiskComposite({
        risk: risk.risk,
        flash: flash.data ?? null,
        suspicious:
          suspicious.status === "ready" ? suspicious.suspicious : null,
        pollMaes,
      }),
    };
  }, [
    risk,
    flash.isPending,
    flash.data,
    suspicious,
    polls.isPending,
    polls.data,
    cycle,
  ]);
};
