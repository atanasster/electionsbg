import { useMemo } from "react";
import { useRiskScore } from "./useRiskScore";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { useSuspiciousSettlements } from "@/data/dashboard/useSuspiciousSections";
import { useBenford } from "@/data/benford/useBenford";

// Composite "Индекс на изборния риск" — five equal-weighted screening
// signals normalized to 0–100, then averaged across the components that
// have data. Each sub-score is independently interpretable so the
// composite is never read alone (the hero always shows the breakdown).
//
// Calibration philosophy: components 1 + 5 are RATES, naturally bounded
// by their denominators. Components 3 + 4 are COUNTS with calibrated
// caps, because we don't have a clean "settlements with votes" total
// without an extra fetch — the caps were chosen so a typical clean
// election lands in the 0–20 band on those components. Component 2 is
// a rate (drift / total machine votes) doubled then capped so small
// drifts still register.
//
// This is a screening composite, NOT a fraud determination. Bands and
// caps are intentionally tuned to make moderate signals visible — the
// methodology callout on every surface that displays this number says
// the same thing.

export type RiskCompositeBand = "calm" | "elevated" | "high" | "critical";

export type RiskCompositeComponentId =
  | "sections"
  | "machine"
  | "concentration"
  | "procedural"
  | "benford";

export type RiskCompositeComponent = {
  id: RiskCompositeComponentId;
  /** 0–100 normalized sub-score; 0 when component is unavailable. */
  value: number;
  available: boolean;
  /** Rendered as the small detail line under each meter — e.g. "240 / 12,705 секции". */
  detail?: string;
};

export type RiskComposite = {
  score: number;
  band: RiskCompositeBand;
  components: RiskCompositeComponent[];
  availableCount: number;
  totalCount: number;
};

const BAND = (score: number): RiskCompositeBand =>
  score < 20 ? "calm" : score < 40 ? "elevated" : score < 60 ? "high" : "critical";

// Cap calibration — see file header. Adjust after seeing 2009–2026
// values across the back-catalogue if the bands look off.
const CONCENTRATION_CAP = 200; // 200 ≥80% settlements → component = 100
const PROCEDURAL_CAP = 600; // 600 invalid+additional flags combined → 100

export const useRiskComposite = (): RiskComposite | null => {
  const { data: risk } = useRiskScore();
  const { countryVotes, votes: regionVotes } = useRegionVotes();
  const { data: suspicious } = useSuspiciousSettlements();
  const { data: benford } = useBenford();

  return useMemo(() => {
    const components: RiskCompositeComponent[] = [];

    // 1. Section screening — weighted band rate. Weights mirror the
    // human read of the bands: critical fully counts, high half, elevated
    // a fifth, low not at all.
    if (risk?.rows.length) {
      let critical = 0;
      let high = 0;
      let elevated = 0;
      for (const r of risk.rows) {
        if (r.band === "critical") critical++;
        else if (r.band === "high") high++;
        else if (r.band === "elevated") elevated++;
      }
      const total = risk.rows.length;
      const weighted = critical * 1.0 + high * 0.5 + elevated * 0.2;
      const value = Math.min(100, (100 * weighted) / total);
      components.push({
        id: "sections",
        value,
        available: true,
        detail: `${critical + high} / ${total}`,
      });
    } else {
      components.push({ id: "sections", value: 0, available: false });
    }

    // 2. Machine integrity — Σ|partyDiff| / totalMachineVotes, doubled
    // then capped. The doubling makes a 0.5% drift register as a 100;
    // we treat any noticeable disagreement between flash and protocol
    // as a meaningful signal worth investigating.
    if (regionVotes) {
      const country = countryVotes();
      let totalMachine = 0;
      let totalDrift = 0;
      let hasFlash = false;
      for (const v of country.results.votes) {
        const m = v.machineVotes ?? 0;
        const s = v.suemgVotes ?? 0;
        totalMachine += m;
        totalDrift += Math.abs(m - s);
        if (m || s) hasFlash = true;
      }
      if (hasFlash && totalMachine > 0) {
        const value = Math.min(100, (200 * totalDrift) / totalMachine);
        components.push({
          id: "machine",
          value,
          available: true,
          detail: `${totalDrift.toLocaleString("bg-BG")} / ${totalMachine.toLocaleString("bg-BG")}`,
        });
      } else {
        components.push({ id: "machine", value: 0, available: false });
      }
    } else {
      components.push({ id: "machine", value: 0, available: false });
    }

    // 3. Geographic concentration — count of settlements with one party
    // ≥80% of the vote, capped at CONCENTRATION_CAP.
    if (suspicious) {
      const count = suspicious.concentrated.count;
      const value = Math.min(100, (100 * count) / CONCENTRATION_CAP);
      components.push({
        id: "concentration",
        value,
        available: true,
        detail: `${count.toLocaleString("bg-BG")}`,
      });
    } else {
      components.push({ id: "concentration", value: 0, available: false });
    }

    // 4. Procedural anomalies — combined count of settlements with
    // ≥10% invalid ballots OR ≥10% additional voters, capped at
    // PROCEDURAL_CAP.
    if (suspicious) {
      const count =
        suspicious.invalidBallots.count + suspicious.additionalVoters.count;
      const value = Math.min(100, (100 * count) / PROCEDURAL_CAP);
      components.push({
        id: "procedural",
        value,
        available: true,
        detail: `${count.toLocaleString("bg-BG")}`,
      });
    } else {
      components.push({ id: "procedural", value: 0, available: false });
    }

    // 5. Statistical fingerprint — Benford 2BL strong-deviation rate
    // among parties with at least 100 sections (per Mebane). Falls back
    // to 1BL only if no party has enough sections for 2BL.
    if (benford?.parties.length) {
      const useSecond = benford.parties.some(
        (p) => (p.secondDigit?.n ?? 0) >= 100,
      );
      const qualifying = benford.parties.filter((p) => {
        const t = useSecond ? p.secondDigit : p.firstDigit;
        return t && t.n >= 100;
      });
      if (qualifying.length) {
        const strong = qualifying.filter((p) => {
          const t = (useSecond ? p.secondDigit : p.firstDigit)!;
          return t.mad >= 0.08;
        }).length;
        const value = (100 * strong) / qualifying.length;
        components.push({
          id: "benford",
          value,
          available: true,
          detail: `${strong} / ${qualifying.length}`,
        });
      } else {
        components.push({ id: "benford", value: 0, available: false });
      }
    } else {
      components.push({ id: "benford", value: 0, available: false });
    }

    const available = components.filter((c) => c.available);
    if (!available.length) return null;
    const score =
      available.reduce((s, c) => s + c.value, 0) / available.length;

    return {
      score,
      band: BAND(score),
      components,
      availableCount: available.length,
      totalCount: components.length,
    };
  }, [risk, countryVotes, regionVotes, suspicious, benford]);
};
