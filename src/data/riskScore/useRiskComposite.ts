import { useMemo, useRef } from "react";
import { useRiskScoreSummary } from "./useRiskScore";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { useSuspiciousSettlements } from "@/data/dashboard/useSuspiciousSections";
import { useBenford } from "@/data/benford/useBenford";
import { useNationalSummary } from "@/data/dashboard/useNationalSummary";
import { useProblemSections } from "@/data/reports/useProblemSections";
import { usePollsAccuracy } from "@/data/polls/usePolls";
import { useElectionContext } from "@/data/ElectionContext";

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
  | "benford"
  | "neighborhoods"
  | "missingFlash"
  | "polls";

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
  score < 20
    ? "calm"
    : score < 40
      ? "elevated"
      : score < 60
        ? "high"
        : "critical";

// Cap calibration — every cap is a percentage of national turnout (or
// of total machine votes for the machine-only components), so the six
// vote-weighted components live on the same denominator. Tweak after
// observing 2009–2026 backtest distributions if the bands look off.
//
// Section screening — band-weighted votes (1.0×crit + 0.5×high + 0.2×elev)
// run ~1.5–2% of turnout for typical post-2021 cycles; cap at 5% so the
// component lands mid-range without saturating on a typical election.
const SECTION_CAP_PCT = 5;
// Concentration — top-party votes in ≥80% settlements; ~0.5–1% of turnout
// is typical, cap at 2% lets a doubling register as max.
const CONCENTRATION_CAP_PCT = 2;
// Procedural anomalies — invalid + additional voters in flagged settlements;
// ~0.3–0.5% of turnout typical, cap at 2%.
const PROCEDURAL_CAP_PCT = 2;
// Risk-neighborhood vote share — structurally ~1% (demographic share of
// the eight tracked communities). Cap at 2% so a doubling reads as max.
const NEIGHBORHOOD_CAP_PCT = 2;
// Missing-flash machine votes as % of all machine votes. Article shows
// ~0.27% in 2026 (peak so far ~0.6% in 2024-06); cap at 1% for headroom.
const MISSING_FLASH_CAP_PCT = 1;
// Polls — pollster mean MAE in pp. Floor below the international ~1.5 pp
// baseline so well-polled elections score 0; cap at 5 pp.
const POLLS_FLOOR_PP = 1.5;
const POLLS_CAP_PP = 5;

export const useRiskComposite = (): RiskComposite | null => {
  const { data: risk } = useRiskScoreSummary();
  const { countryVotes, votes: regionVotes } = useRegionVotes();
  const { data: suspicious } = useSuspiciousSettlements();
  const { data: benford } = useBenford();
  const { data: national } = useNationalSummary();
  const { data: problemSections } = useProblemSections();
  const { data: pollsAccuracy } = usePollsAccuracy();
  const { selected } = useElectionContext();

  // Sticky cache: keep the last coherent composite around so that during
  // a year switch the hero/ribbon don't flash to null while React Query
  // is settling the new data. We render the previous value (one frame
  // off, but valid) instead of disappearing — much less jarring.
  const lastCoherentRef = useRef<RiskComposite | null>(null);

  const fresh = useMemo(() => {
    // Coherence gate: every election-stamped data source must report the
    // currently selected election. React Query's per-hook fetches settle
    // at slightly different times after a year change, so without this
    // guard the composite would briefly render a Frankenstein value
    // mixing old + new election data — the visible "30 → other → 30"
    // flicker on year switch.
    if (
      !risk ||
      risk.election !== selected ||
      !suspicious ||
      suspicious.election !== selected ||
      !national ||
      national.election !== selected
    ) {
      return null;
    }

    const components: RiskCompositeComponent[] = [];

    // 1. Section screening — VOTE-weighted band rate. Sums section
    // votes by band, weights critical=1.0, high=0.5, elevated=0.2, and
    // expresses as % of national turnout. The band weights are the
    // confidence in each anomaly tier; the result reads as "what fraction
    // of the national vote sits in sections we'd flag for review."
    if (risk?.votesByBand && risk.totalActualVoters > 0) {
      const { critical, high, elevated } = risk.votesByBand;
      const weighted = critical * 1.0 + high * 0.5 + elevated * 0.2;
      const sharePct = (100 * weighted) / risk.totalActualVoters;
      const value = Math.min(100, (100 * sharePct) / SECTION_CAP_PCT);
      components.push({
        id: "sections",
        value,
        available: true,
        detail: `${Math.round(weighted).toLocaleString("bg-BG")} / ${risk.totalActualVoters.toLocaleString("bg-BG")} (${sharePct.toFixed(2)}%)`,
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

    // 3. Geographic concentration — VOTE-weighted: top-party votes in
    // ≥80% concentrated settlements, as % of national turnout. Capped
    // at CONCENTRATION_CAP_PCT.
    if (suspicious && suspicious.nationalActualVoters > 0) {
      const v = suspicious.concentrated.votesAffected ?? 0;
      const total = suspicious.nationalActualVoters;
      const sharePct = (100 * v) / total;
      const value = Math.min(100, (100 * sharePct) / CONCENTRATION_CAP_PCT);
      components.push({
        id: "concentration",
        value,
        available: true,
        detail: `${v.toLocaleString("bg-BG")} / ${total.toLocaleString("bg-BG")} (${sharePct.toFixed(2)}%)`,
      });
    } else {
      components.push({ id: "concentration", value: 0, available: false });
    }

    // 4. Procedural anomalies — VOTE-weighted: invalid + additional
    // voters in flagged settlements, as % of national turnout. Capped
    // at PROCEDURAL_CAP_PCT.
    if (suspicious && suspicious.nationalActualVoters > 0) {
      const v =
        (suspicious.invalidBallots.votesAffected ?? 0) +
        (suspicious.additionalVoters.votesAffected ?? 0);
      const total = suspicious.nationalActualVoters;
      const sharePct = (100 * v) / total;
      const value = Math.min(100, (100 * sharePct) / PROCEDURAL_CAP_PCT);
      components.push({
        id: "procedural",
        value,
        available: true,
        detail: `${v.toLocaleString("bg-BG")} / ${total.toLocaleString("bg-BG")} (${sharePct.toFixed(2)}%)`,
      });
    } else {
      components.push({ id: "procedural", value: 0, available: false });
    }

    // 5. Risk neighborhoods — share of national turnout in the eight
    // tracked communities. The integrity article identifies this as the
    // single largest integrity-flagged vote bucket in the dataset.
    // Structural signal (vote share is constrained by the demographic
    // share of these communities) so values cluster around the cap; the
    // discrimination comes from elections where the share drifts up.
    if (problemSections?.neighborhoods?.length && national?.turnout?.actual) {
      let mahalaVoters = 0;
      for (const n of problemSections.neighborhoods) {
        for (const s of n.sections ?? []) {
          mahalaVoters += s.results?.protocol?.totalActualVoters ?? 0;
        }
      }
      const total = national.turnout.actual;
      const sharePct = (100 * mahalaVoters) / total;
      const value = Math.min(100, (100 * sharePct) / NEIGHBORHOOD_CAP_PCT);
      components.push({
        id: "neighborhoods",
        value,
        available: true,
        detail: `${mahalaVoters.toLocaleString("bg-BG")} / ${total.toLocaleString("bg-BG")} (${sharePct.toFixed(2)}%)`,
      });
    } else {
      components.push({ id: "neighborhoods", value: 0, available: false });
    }

    // 6. Missing flash auditability — VOTE-weighted: machine votes in
    // sections that ran machines but submitted no flash drive (and so
    // can't be end-to-end audited), as % of total machine votes. Capped
    // at MISSING_FLASH_CAP_PCT.
    if (
      risk &&
      typeof risk.missingFlashMachineVotes === "number" &&
      regionVotes
    ) {
      const country = countryVotes();
      let totalMachine = 0;
      for (const v of country.results.votes)
        totalMachine += v.machineVotes ?? 0;
      const v = risk.missingFlashMachineVotes;
      if (
        totalMachine > 0 &&
        (v > 0 || national?.anomalies?.suemgMissingFlash)
      ) {
        const sharePct = (100 * v) / totalMachine;
        const value = Math.min(100, (100 * sharePct) / MISSING_FLASH_CAP_PCT);
        components.push({
          id: "missingFlash",
          value,
          available: true,
          detail: `${v.toLocaleString("bg-BG")} / ${totalMachine.toLocaleString("bg-BG")} (${sharePct.toFixed(2)}%)`,
        });
      } else {
        components.push({ id: "missingFlash", value: 0, available: false });
      }
    } else {
      components.push({ id: "missingFlash", value: 0, available: false });
    }

    // 7. Statistical fingerprint — Benford 2BL strong-deviation rate
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

    // 8. Polling discrepancy — mean MAE across all agencies that polled
    // this election, offset and capped: ≤1.5 pp (international baseline)
    // = 0, ≥5 pp = max. The article includes the polling miss as one of
    // the headline integrity-adjacent signals; the offset calibration
    // mitigates the "BG polls always elevated" concern by treating
    // typical accuracy as a neutral 0 rather than a permanent floor.
    // Polling error has structural causes (methodology, late deciders,
    // sample bias) — high values here do NOT imply election irregularity,
    // only forecast failure.
    const electionIsoForPolls = selected?.replace(/_/g, "-");
    const pollsEntry = pollsAccuracy?.elections.find(
      (e) => e.electionDate === electionIsoForPolls,
    );
    if (pollsEntry && pollsEntry.agencies.length > 0) {
      const meanMae =
        pollsEntry.agencies.reduce((s, a) => s + a.mae, 0) /
        pollsEntry.agencies.length;
      const value = Math.min(
        100,
        Math.max(
          0,
          ((meanMae - POLLS_FLOOR_PP) / (POLLS_CAP_PP - POLLS_FLOOR_PP)) * 100,
        ),
      );
      components.push({
        id: "polls",
        value,
        available: true,
        detail: `${meanMae.toFixed(2)} pp`,
      });
    } else {
      components.push({ id: "polls", value: 0, available: false });
    }

    const available = components.filter((c) => c.available);
    if (!available.length) return null;
    const score = available.reduce((s, c) => s + c.value, 0) / available.length;

    return {
      score,
      band: BAND(score),
      components,
      availableCount: available.length,
      totalCount: components.length,
    };
  }, [
    risk,
    countryVotes,
    regionVotes,
    suspicious,
    benford,
    national,
    problemSections,
    pollsAccuracy,
    selected,
  ]);

  // If the freshly-computed composite is coherent, cache and return it.
  // Otherwise (mid-transition between elections), fall back to the last
  // coherent value so the UI doesn't flash to empty. On first load both
  // are null, which lets the hero/ribbon stay hidden until first paint.
  if (fresh) {
    lastCoherentRef.current = fresh;
    return fresh;
  }
  return lastCoherentRef.current;
};
