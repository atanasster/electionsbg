import { useMemo, useRef } from "react";
import { useRiskScoreSummary } from "./useRiskScore";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { useSuspiciousSettlements } from "@/data/dashboard/useSuspiciousSections";
import { useBenford } from "@/data/benford/useBenford";
import { useNationalSummary } from "@/data/dashboard/useNationalSummary";
import { useProblemSections } from "@/data/reports/useProblemSections";
import { useProblemSectionsStats } from "@/data/reports/useProblemSectionsStats";
import { usePollsAccuracy } from "@/data/polls/usePolls";
import { useRiskClusters } from "./useRiskClusters";
import { useElectionContext } from "@/data/ElectionContext";

// Composite "Индекс на изборния риск" — split into two tracks:
//   • Integrity (headline): five process-integrity signals averaged into
//     the 0–100 score shown on the hero / home ribbon. Each measures a
//     way the recorded result could diverge from the cast votes.
//   • Context (informational): five statistical / structural / forecast
//     signals shown alongside but NOT averaged into the headline. They
//     can light up in perfectly clean elections (Benford failures by
//     range-bounding, неполучаваеми demographic-baseline махала share,
//     legitimate late shifts in voter intent, etc.).
//
// The integrity-track signals are vote-weighted (as a share of national
// turnout or of total machine votes) so they all live on the same
// denominator. Context-track signals use their own natural metric.
//
// This is a SCREENING composite, not a fraud determination. Bands and
// caps are tuned to make moderate process-integrity signals visible
// without context noise dragging the headline up.

export type RiskCompositeBand = "calm" | "elevated" | "high" | "critical";
export type RiskCompositeTrack = "integrity" | "context";

export type RiskCompositeComponentId =
  // integrity
  | "sections"
  | "machine"
  | "missingFlash"
  | "concentration"
  | "procedural"
  // context
  | "benford"
  | "neighborhoodsSwing"
  | "voteSwitching"
  | "polls"
  | "clusters";

export type RiskCompositeComponent = {
  id: RiskCompositeComponentId;
  track: RiskCompositeTrack;
  /** 0–100 normalized sub-score; 0 when component is unavailable. */
  value: number;
  available: boolean;
  /** Rendered as the small detail line under each meter — e.g. "240 / 12,705 секции". */
  detail?: string;
};

export type RiskComposite = {
  /** Headline 0–100 — integrity-track average only. */
  score: number;
  band: RiskCompositeBand;
  /** Informational context-track average. Never folded into `score`. */
  contextScore: number | null;
  components: RiskCompositeComponent[];
  integrityAvailableCount: number;
  integrityTotalCount: number;
  contextAvailableCount: number;
  contextTotalCount: number;
};

const BAND = (score: number): RiskCompositeBand =>
  score < 20
    ? "calm"
    : score < 40
      ? "elevated"
      : score < 60
        ? "high"
        : "critical";

// Cap calibration — vote-weighted integrity components live on a single
// denominator (national turnout, or total machine votes for the machine-
// only signals). Tweak after observing 2009–2026 backtest distributions
// if the bands look off.
//
// Section screening — band-weighted votes (1.0×crit + 0.5×high + 0.2×elev)
// run ~1.5–2% of turnout for typical post-2021 cycles; cap at 5% so the
// component lands mid-range without saturating on a typical election.
const SECTION_CAP_PCT = 5;
// Machine drift — Σ|partyDrift| ÷ total machine votes. Tighter than the
// original 0.5% because international audit-trigger thresholds (US recount
// rules, Mexico INE) fire at well under 0.5% margins; 0.2% is conservative.
const MACHINE_DRIFT_CAP_PCT = 0.2;
// Missing-flash machine votes as % of all machine votes. Article shows
// ~0.27% in 2026 (peak so far ~0.6% in 2024-06); cap at 1% for headroom.
const MISSING_FLASH_CAP_PCT = 1;
// Concentration — top-party votes in ≥80% settlements; ~0.5–1% of turnout
// is typical, cap at 2% lets a doubling register as max.
const CONCENTRATION_CAP_PCT = 2;
// Procedural anomalies — invalid + additional voters in flagged settlements;
// ~0.3–0.5% of turnout typical, cap at 2%.
const PROCEDURAL_CAP_PCT = 2;
// Risk-neighborhood EXCESS swing — pp of swing in the aggregate top-party
// share inside the eight tracked communities, ABOVE the same party's
// national swing. >10pp excess swing is the canonical broker-managed-
// turnout fingerprint (Stokes et al. 2013). Cap at 15pp = 100.
const NEIGHBORHOOD_SWING_CAP_PP = 15;
// Pedersen electoral-volatility index (national). Floor at 5pp (typical
// stable-democracy churn) so well-anchored cycles read 0; cap at 30
// (BG 2021–2022 hyper-volatile cycles hit ~40+, so this saturates fast).
const VOTE_SWITCHING_FLOOR_PP = 5;
const VOTE_SWITCHING_CAP_PP = 30;
// Polls — pollster mean MAE in pp. Floor below the international ~1.5 pp
// baseline so well-polled elections score 0; cap at 5 pp. Polls are in
// the CONTEXT track because high MAE measures forecast failure, not
// election irregularity.
const POLLS_FLOOR_PP = 1.5;
const POLLS_CAP_PP = 5;
// Spatial risk clusters — share of geolocatable elevated+ sections that
// fall into a same-party geographic cluster (scripts/reports/risk_score.ts
// buildRiskClusters). The 2005–2026 backtest sits in a narrow 8–17% band;
// floor at 5% (irreducible structural clustering reads calm cycles low),
// cap at 20% (a fifth of all flagged sections clustering is a strong
// spatial-concentration signal — above the 16.7% historical peak).
const CLUSTER_SHARE_FLOOR_PCT = 5;
const CLUSTER_SHARE_CAP_PCT = 20;

// Match a party across cycles by canonical-name overlap, falling back to
// nickname equality. commonName arrays carry the rename/coalition history
// (БСП → БСП-ОЛ → БСП-АБВ, ДПС → АПС-ДПС, etc.).
const sharesEquivalent = (
  a: { nickName?: string; commonName?: string[] },
  b: { nickName?: string; commonName?: string[] },
): boolean => {
  if (a.nickName && b.nickName && a.nickName === b.nickName) return true;
  const aNames = new Set<string>();
  if (a.nickName) aNames.add(a.nickName);
  for (const c of a.commonName ?? []) aNames.add(c);
  const bNames = new Set<string>();
  if (b.nickName) bNames.add(b.nickName);
  for (const c of b.commonName ?? []) bNames.add(c);
  for (const n of aNames) if (bNames.has(n)) return true;
  return false;
};

export const useRiskComposite = (): RiskComposite | null => {
  const { data: risk } = useRiskScoreSummary();
  const { countryVotes, votes: regionVotes } = useRegionVotes();
  const { data: suspicious } = useSuspiciousSettlements();
  const { data: benford } = useBenford();
  const { data: national } = useNationalSummary();
  const { data: problemSections } = useProblemSections();
  const { data: problemSectionsStats } = useProblemSectionsStats();
  const { data: pollsAccuracy } = usePollsAccuracy();
  const { data: clusters } = useRiskClusters();
  const { selected, electionStats, priorElections } = useElectionContext();

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

    // ── INTEGRITY TRACK ────────────────────────────────────────────

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
        track: "integrity",
        value,
        available: true,
        detail: `${Math.round(weighted).toLocaleString("bg-BG")} / ${risk.totalActualVoters.toLocaleString("bg-BG")} (${sharePct.toFixed(2)}%)`,
      });
    } else {
      components.push({
        id: "sections",
        track: "integrity",
        value: 0,
        available: false,
      });
    }

    // 2. Machine integrity — Σ|partyDiff| / totalMachineVotes, expressed
    // as % of total machine votes, capped at 0.2% (international recount-
    // trigger neighborhood). Any noticeable disagreement between flash
    // and protocol is treated as a meaningful audit-quality signal.
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
        const sharePct = (100 * totalDrift) / totalMachine;
        const value = Math.min(100, (100 * sharePct) / MACHINE_DRIFT_CAP_PCT);
        components.push({
          id: "machine",
          track: "integrity",
          value,
          available: true,
          detail: `${totalDrift.toLocaleString("bg-BG")} / ${totalMachine.toLocaleString("bg-BG")} (${sharePct.toFixed(2)}%)`,
        });
      } else {
        components.push({
          id: "machine",
          track: "integrity",
          value: 0,
          available: false,
        });
      }
    } else {
      components.push({
        id: "machine",
        track: "integrity",
        value: 0,
        available: false,
      });
    }

    // 3. Missing flash auditability — VOTE-weighted: machine votes in
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
          track: "integrity",
          value,
          available: true,
          detail: `${v.toLocaleString("bg-BG")} / ${totalMachine.toLocaleString("bg-BG")} (${sharePct.toFixed(2)}%)`,
        });
      } else {
        components.push({
          id: "missingFlash",
          track: "integrity",
          value: 0,
          available: false,
        });
      }
    } else {
      components.push({
        id: "missingFlash",
        track: "integrity",
        value: 0,
        available: false,
      });
    }

    // 4. Geographic concentration — VOTE-weighted: top-party votes in
    // ≥80% concentrated settlements, as % of national turnout. Capped
    // at CONCENTRATION_CAP_PCT.
    if (suspicious && suspicious.nationalActualVoters > 0) {
      const v = suspicious.concentrated.votesAffected ?? 0;
      const total = suspicious.nationalActualVoters;
      const sharePct = (100 * v) / total;
      const value = Math.min(100, (100 * sharePct) / CONCENTRATION_CAP_PCT);
      components.push({
        id: "concentration",
        track: "integrity",
        value,
        available: true,
        detail: `${v.toLocaleString("bg-BG")} / ${total.toLocaleString("bg-BG")} (${sharePct.toFixed(2)}%)`,
      });
    } else {
      components.push({
        id: "concentration",
        track: "integrity",
        value: 0,
        available: false,
      });
    }

    // 5. Procedural anomalies — VOTE-weighted: invalid + additional
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
        track: "integrity",
        value,
        available: true,
        detail: `${v.toLocaleString("bg-BG")} / ${total.toLocaleString("bg-BG")} (${sharePct.toFixed(2)}%)`,
      });
    } else {
      components.push({
        id: "procedural",
        track: "integrity",
        value: 0,
        available: false,
      });
    }

    // ── CONTEXT TRACK ──────────────────────────────────────────────

    // 6. Statistical fingerprint — Benford 2BL strong-deviation rate
    // among parties with at least 100 sections (per Mebane). Falls back
    // to 1BL only if no party has enough sections for 2BL. In context
    // track because Benford on range-bounded vote counts fails by
    // construction; deviation is a "look closer" cue, not an integrity
    // signal.
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
          track: "context",
          value,
          available: true,
          detail: `${strong} / ${qualifying.length}`,
        });
      } else {
        components.push({
          id: "benford",
          track: "context",
          value: 0,
          available: false,
        });
      }
    } else {
      components.push({
        id: "benford",
        track: "context",
        value: 0,
        available: false,
      });
    }

    // 7. Risk-neighborhood EXCESS swing — the top party's share in the
    // eight tracked communities this cycle minus its share last cycle,
    // MINUS the same party's national swing over the same pair of cycles.
    // Static aggregate share is structurally pinned by demographics and
    // tells you nothing about anomalous broker-managed turnout (Stokes
    // et al. 2013; Cantú 2014). Excess swing isolates the cycle-specific
    // signal: "did these communities move more than the rest of the
    // country toward a single party between elections?" Cap 15pp = 100.
    if (problemSections?.neighborhoods?.length && problemSectionsStats) {
      const priorName = priorElections?.name;
      const priorStats = priorName
        ? problemSectionsStats.find((e) => e.name === priorName)
        : undefined;
      const priorTotals = priorStats?.results?.votes ?? [];
      const priorNational = priorElections?.results?.votes ?? [];
      const currentNational = electionStats?.results?.votes ?? [];

      // Aggregate current махала vote totals per party.
      const currentMahala = new Map<
        number,
        { votes: number; nickName?: string; commonName?: string[] }
      >();
      let currentMahalaTotal = 0;
      for (const n of problemSections.neighborhoods) {
        for (const s of n.sections ?? []) {
          for (const v of s.results?.votes ?? []) {
            const prev = currentMahala.get(v.partyNum);
            const votes = (prev?.votes ?? 0) + v.totalVotes;
            const meta = currentNational.find((p) => p.partyNum === v.partyNum);
            currentMahala.set(v.partyNum, {
              votes,
              nickName: meta?.nickName,
              commonName: meta?.commonName,
            });
            currentMahalaTotal += v.totalVotes;
          }
        }
      }

      // Top party by current махала vote.
      let topPartyNum: number | null = null;
      let topVotes = 0;
      for (const [num, info] of currentMahala) {
        if (info.votes > topVotes) {
          topVotes = info.votes;
          topPartyNum = num;
        }
      }

      const topMeta =
        topPartyNum != null ? currentMahala.get(topPartyNum) : null;
      const priorTotal = priorTotals.reduce((s, v) => s + v.totalVotes, 0);
      const currentNationalTotal = currentNational.reduce(
        (s, v) => s + v.totalVotes,
        0,
      );
      const priorNationalTotal = priorNational.reduce(
        (s, v) => s + v.totalVotes,
        0,
      );

      if (
        topMeta &&
        currentMahalaTotal > 0 &&
        priorTotal > 0 &&
        currentNationalTotal > 0 &&
        priorNationalTotal > 0
      ) {
        // Top party's prior share in махала (match by canonical name).
        const priorMatch = priorTotals.find((v) =>
          sharesEquivalent(
            { nickName: v.nickName, commonName: v.commonName },
            topMeta,
          ),
        );
        const currMahalaShare = (100 * topMeta.votes) / currentMahalaTotal;
        const priorMahalaShare = priorMatch
          ? (100 * priorMatch.totalVotes) / priorTotal
          : 0;

        // Same party's national share, both cycles.
        const currNationalRow = currentNational.find(
          (v) => v.partyNum === topPartyNum,
        );
        const priorNationalRow = priorNational.find((v) =>
          sharesEquivalent(
            { nickName: v.nickName, commonName: v.commonName },
            topMeta,
          ),
        );
        const currNationalShare = currNationalRow
          ? (100 * currNationalRow.totalVotes) / currentNationalTotal
          : 0;
        const priorNationalShare = priorNationalRow
          ? (100 * priorNationalRow.totalVotes) / priorNationalTotal
          : 0;

        const deltaMahala = currMahalaShare - priorMahalaShare;
        const deltaNational = currNationalShare - priorNationalShare;
        const excessPp = Math.abs(deltaMahala - deltaNational);
        const value = Math.min(
          100,
          (100 * excessPp) / NEIGHBORHOOD_SWING_CAP_PP,
        );
        const sign = deltaMahala - deltaNational >= 0 ? "+" : "−";
        components.push({
          id: "neighborhoodsSwing",
          track: "context",
          value,
          available: true,
          detail: `${topMeta.nickName ?? "?"}: ${sign}${excessPp.toFixed(1)}pp`,
        });
      } else {
        // Prior-cycle data missing (first election in series, or мaхалa
        // section codes don't resolve pre-2009) — mark unavailable
        // rather than fabricate a number.
        components.push({
          id: "neighborhoodsSwing",
          track: "context",
          value: 0,
          available: false,
        });
      }
    } else {
      components.push({
        id: "neighborhoodsSwing",
        track: "context",
        value: 0,
        available: false,
      });
    }

    // 8. Electoral volatility — Pedersen index across consecutive
    // elections. Pedersen (1979) is the standard comparative-politics
    // measure of net vote transfer between parties: 0.5 × Σ |Δshare|.
    // High values typically signal new entrants or major realignments
    // (1991 Russia, 2013 Italy 5SM, 2021 BG Promyana surge). NOT an
    // integrity signal — it's the climate in which integrity questions
    // become harder to disentangle from legitimate volatility.
    if (electionStats?.results?.votes && priorElections?.results?.votes) {
      const curr = electionStats.results.votes;
      const prior = priorElections.results.votes;
      const currTotal = curr.reduce((s, v) => s + v.totalVotes, 0);
      const priorTotal = prior.reduce((s, v) => s + v.totalVotes, 0);
      if (currTotal > 0 && priorTotal > 0) {
        const used = new Set<number>();
        let sumAbsDelta = 0;
        for (const c of curr) {
          const cShare = (100 * c.totalVotes) / currTotal;
          const match = prior.find(
            (p) =>
              !used.has(p.partyNum) &&
              sharesEquivalent(
                { nickName: p.nickName, commonName: p.commonName },
                { nickName: c.nickName, commonName: c.commonName },
              ),
          );
          if (match) used.add(match.partyNum);
          const pShare = match ? (100 * match.totalVotes) / priorTotal : 0;
          sumAbsDelta += Math.abs(cShare - pShare);
        }
        for (const p of prior) {
          if (used.has(p.partyNum)) continue;
          const pShare = (100 * p.totalVotes) / priorTotal;
          sumAbsDelta += pShare; // disappeared party
        }
        const pedersen = sumAbsDelta / 2;
        const value = Math.min(
          100,
          Math.max(
            0,
            ((pedersen - VOTE_SWITCHING_FLOOR_PP) /
              (VOTE_SWITCHING_CAP_PP - VOTE_SWITCHING_FLOOR_PP)) *
              100,
          ),
        );
        components.push({
          id: "voteSwitching",
          track: "context",
          value,
          available: true,
          detail: `Pedersen ${pedersen.toFixed(1)}`,
        });
      } else {
        components.push({
          id: "voteSwitching",
          track: "context",
          value: 0,
          available: false,
        });
      }
    } else {
      components.push({
        id: "voteSwitching",
        track: "context",
        value: 0,
        available: false,
      });
    }

    // 9. Polling discrepancy — mean MAE across all agencies that polled
    // this election, offset and capped: ≤1.5 pp (international baseline)
    // = 0, ≥5 pp = max. CONTEXT track: pollster error has structural
    // causes (methodology, late deciders, sample bias, BG-specific legal
    // blackout) and high values do NOT imply election irregularity, only
    // forecast failure. A poll miss should TRIGGER closer inspection of
    // the integrity-track components, not contribute to the headline.
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
        track: "context",
        value,
        available: true,
        detail: `${meanMae.toFixed(2)} pp`,
      });
    } else {
      components.push({
        id: "polls",
        track: "context",
        value: 0,
        available: false,
      });
    }

    // 10. Spatial risk clusters — share of the geolocatable elevated+
    // sections that fall into a same-party geographic cluster (a knot of
    // adjacent flagged sections, the controlled/corporate-vote
    // fingerprint). CONTEXT track: it re-describes sections already
    // counted by the integrity-track section-screening signal, so it must
    // never feed the headline; and clustering is partly structural
    // (risk factors are geographically correlated). Floor 5%, cap 20%.
    if (
      clusters &&
      clusters.election === selected &&
      clusters.mapSections.length > 0
    ) {
      const clustered = new Set<string>();
      for (const cl of clusters.clusters)
        for (const s of cl.sections) clustered.add(s);
      const flagged = clusters.mapSections.length;
      const sharePct = (100 * clustered.size) / flagged;
      const value = Math.min(
        100,
        Math.max(
          0,
          ((sharePct - CLUSTER_SHARE_FLOOR_PCT) /
            (CLUSTER_SHARE_CAP_PCT - CLUSTER_SHARE_FLOOR_PCT)) *
            100,
        ),
      );
      components.push({
        id: "clusters",
        track: "context",
        value,
        available: true,
        detail: `${clustered.size.toLocaleString("bg-BG")} / ${flagged.toLocaleString("bg-BG")} (${sharePct.toFixed(1)}%)`,
      });
    } else {
      components.push({
        id: "clusters",
        track: "context",
        value: 0,
        available: false,
      });
    }

    const integrity = components.filter((c) => c.track === "integrity");
    const context = components.filter((c) => c.track === "context");
    const integrityAvail = integrity.filter((c) => c.available);
    const contextAvail = context.filter((c) => c.available);
    if (!integrityAvail.length) return null;
    const score =
      integrityAvail.reduce((s, c) => s + c.value, 0) / integrityAvail.length;
    const contextScore = contextAvail.length
      ? contextAvail.reduce((s, c) => s + c.value, 0) / contextAvail.length
      : null;

    return {
      score,
      band: BAND(score),
      contextScore,
      components,
      integrityAvailableCount: integrityAvail.length,
      integrityTotalCount: integrity.length,
      contextAvailableCount: contextAvail.length,
      contextTotalCount: context.length,
    };
  }, [
    risk,
    countryVotes,
    regionVotes,
    suspicious,
    benford,
    national,
    problemSections,
    problemSectionsStats,
    pollsAccuracy,
    clusters,
    selected,
    electionStats,
    priorElections,
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
