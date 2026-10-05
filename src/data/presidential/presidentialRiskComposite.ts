// The presidential „Индекс на изборния риск" for one round — the parliamentary
// `computeRiskComposite`, fed from the presidential artifacts. Same component ids, same caps,
// same bands, same rule: the headline is the mean of the AVAILABLE integrity components, and the
// context track is shown beside it, never folded in.
//
// Integrity, each vote-weighted on the round's own denominator:
//   sections      band-weighted actual voters (1.0 critical, 0.5 high, 0.2 elevated) from
//                 `risk_score.json`, as % of the scored sections' voters
//   machine       Σ|protocol − flash| over the tickets ÷ compared machine votes   (`flash.json`)
//   missingFlash  machine votes the flash export does not reach ÷ all machine votes (`flash.json`)
//   concentration votes in ≥80% settlements ÷ all actual voters  (`suspicious_settlements.json`)
//   procedural    votes in invalid- or added-voter-flagged settlements ÷ all actual voters
//                 — each settlement flag ONLY when its producer marks it as discriminating
// Context:
//   polls         the agencies' mean round-one MAE (parliamentary rule), round one only
//
// ⚠ UNAVAILABLE IS NOT ZERO. Only 2021 published its flash records, so the two machine components
// are unavailable — and leave the average — for every other cycle, exactly as the parliamentary
// index treats an election without СУЕМГ data. Benford, cross-election vote switching, risk
// clusters and the neighbourhood swing have no presidential producer and are listed unavailable.
//
// ⚠ PURE: no React, no fetching, so it can be tested on fixtures and reused by a non-React caller.

import {
  BAND,
  CONCENTRATION_CAP_PCT,
  MACHINE_DRIFT_CAP_PCT,
  MISSING_FLASH_CAP_PCT,
  POLLS_CAP_PP,
  POLLS_FLOOR_PP,
  PROCEDURAL_CAP_PCT,
  SECTION_CAP_PCT,
  type RiskComposite,
  type RiskCompositeComponent,
  type RiskCompositeComponentId,
} from "@/data/riskScore/computeRiskComposite";
import type { PresidentialRiskScore } from "./useRiskScore";
import type { PresidentialFlashDiff } from "./useFlashDiff";
import type { PresidentialSuspicious } from "./useSuspiciousSettlements";

export type PresidentialRiskCompositeInputs = {
  risk: PresidentialRiskScore;
  /** Absent for every cycle but 2021 — no flash records were published. */
  flash: PresidentialFlashDiff | null;
  suspicious: PresidentialSuspicious | null;
  /** Agencies' round-one MAE for this cycle (parliamentary rule); empty when none was graded. */
  pollMaes: readonly number[];
};

const fmt = (n: number) => Math.round(n).toLocaleString("bg-BG");

const share = (
  id: RiskCompositeComponentId,
  numerator: number,
  denominator: number,
  capPct: number,
): RiskCompositeComponent => {
  const pct = (100 * numerator) / denominator;
  return {
    id,
    track: "integrity",
    value: Math.min(100, (100 * pct) / capPct),
    available: true,
    detail: `${fmt(numerator)} / ${fmt(denominator)} (${pct.toFixed(2)}%)`,
  };
};

const unavailable = (
  id: RiskCompositeComponentId,
  track: RiskCompositeComponent["track"],
): RiskCompositeComponent => ({ id, track, value: 0, available: false });

export const computePresidentialRiskComposite = ({
  risk,
  flash,
  suspicious,
  pollMaes,
}: PresidentialRiskCompositeInputs): RiskComposite | null => {
  const components: RiskCompositeComponent[] = [];

  const { critical, high, elevated } = risk.votesByBand;
  components.push(
    risk.coverage.totalActualVoters > 0
      ? share(
          "sections",
          critical + 0.5 * high + 0.2 * elevated,
          risk.coverage.totalActualVoters,
          SECTION_CAP_PCT,
        )
      : unavailable("sections", "integrity"),
  );

  const compared = flash
    ? flash.tickets.reduce((a, t) => a + t.machineVotes, 0)
    : 0;
  if (flash && compared > 0) {
    const drift = flash.tickets.reduce(
      (a, t) => a + Math.abs(t.machineVotes - t.flashVotes),
      0,
    );
    components.push(share("machine", drift, compared, MACHINE_DRIFT_CAP_PCT));
    components.push(
      share(
        "missingFlash",
        flash.coverage.uncomparedMachineVotes,
        compared + flash.coverage.uncomparedMachineVotes,
        MISSING_FLASH_CAP_PCT,
      ),
    );
  } else {
    components.push(unavailable("machine", "integrity"));
    components.push(unavailable("missingFlash", "integrity"));
  }

  // ⚠⚠ A SETTLEMENT FLAG COUNTS ONLY WHERE IT DISCRIMINATES. In a two-ticket runoff, or a round
  // one with a dominant winner, settlements at 80%+ for one ticket are ordinary — 2021 round one
  // has a 51.7% national rate and 12.4% of settlements over the bar — and the producer marks the
  // flag `discriminating: false` for exactly that. Vote-weighting it anyway saturated this
  // component at 100 in 7 of 10 rounds: a statement about the year, scored as an integrity risk.
  // A non-discriminating flag leaves the component, and an all-silent component leaves the
  // average, like any other unavailable signal.
  const voters = risk.coverage.allSectionsActualVoters;
  const flagged = (
    keys: ("concentrated" | "invalidBallots" | "additionalVoters")[],
  ) => (suspicious ? keys.filter((k) => suspicious[k].discriminating) : []);
  const concentrated = flagged(["concentrated"]);
  components.push(
    suspicious && voters > 0 && concentrated.length
      ? share(
          "concentration",
          suspicious.concentrated.votesAffected,
          voters,
          CONCENTRATION_CAP_PCT,
        )
      : unavailable("concentration", "integrity"),
  );
  const procedural = flagged(["invalidBallots", "additionalVoters"]);
  components.push(
    suspicious && voters > 0 && procedural.length
      ? share(
          "procedural",
          procedural.reduce((a, k) => a + suspicious[k].votesAffected, 0),
          voters,
          PROCEDURAL_CAP_PCT,
        )
      : unavailable("procedural", "integrity"),
  );

  if (risk.round === 1 && pollMaes.length) {
    const mean = pollMaes.reduce((a, b) => a + b, 0) / pollMaes.length;
    components.push({
      id: "polls",
      track: "context",
      value: Math.max(
        0,
        Math.min(
          100,
          ((mean - POLLS_FLOOR_PP) / (POLLS_CAP_PP - POLLS_FLOOR_PP)) * 100,
        ),
      ),
      available: true,
      detail: `MAE ${mean.toFixed(2)} (${pollMaes.length})`,
    });
  } else components.push(unavailable("polls", "context"));
  for (const id of [
    "benford",
    "neighborhoodsSwing",
    "voteSwitching",
    "clusters",
  ] as const)
    components.push(unavailable(id, "context"));

  const integrity = components.filter((c) => c.track === "integrity");
  const context = components.filter((c) => c.track === "context");
  const integrityAvail = integrity.filter((c) => c.available);
  const contextAvail = context.filter((c) => c.available);
  if (!integrityAvail.length) return null;
  const score =
    integrityAvail.reduce((s, c) => s + c.value, 0) / integrityAvail.length;
  return {
    score,
    band: BAND(score),
    contextScore: contextAvail.length
      ? contextAvail.reduce((s, c) => s + c.value, 0) / contextAvail.length
      : null,
    components,
    integrityAvailableCount: integrityAvail.length,
    integrityTotalCount: integrity.length,
    contextAvailableCount: contextAvail.length,
    contextTotalCount: context.length,
  };
};
