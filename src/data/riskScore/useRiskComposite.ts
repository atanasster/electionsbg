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
import {
  computeRiskComposite,
  type RiskComposite,
} from "./computeRiskComposite";

// The composite computation itself lives in the framework-agnostic
// `computeRiskComposite` (shared with the AI-chat `riskIndex` tool). This hook
// is the React adapter: it wires the React-Query sources in, aggregates the
// country vote totals, and keeps a sticky cache so the hero/ribbon don't flash
// to null mid-transition between elections.
export type {
  RiskComposite,
  RiskCompositeBand,
  RiskCompositeTrack,
  RiskCompositeComponentId,
  RiskCompositeComponent,
} from "./computeRiskComposite";

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

  const fresh = useMemo(
    () =>
      computeRiskComposite({
        selected,
        risk,
        // Aggregate region votes to a single country-level row set (matching
        // the hook's `countryVotes()`); null when region votes haven't loaded.
        countryVotes: regionVotes ? countryVotes() : null,
        suspicious,
        benford,
        national,
        problemSections,
        problemSectionsStats,
        pollsAccuracy,
        clusters,
        electionStats,
        priorElections,
      }),
    [
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
    ],
  );

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
