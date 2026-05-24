// Page-level override for the "as of" anchor used by useElectionAsOf and
// useElectionYear. When IndicatorsCompareScreen wraps its sections in
// <CompareAnchorContext.Provider>, every quarterly/annual snapshot inside
// re-anchors to the selected cabinet's tenure instead of the election date.
// Pages that don't mount the provider get the original election-driven
// behavior.
//
// Keeping this as a context rather than threading props through five panels
// means PeerSnapshotTable, EuCompareWgiRadar, EuCompareCofogMultiples,
// EuCompareInequalityPanel and EuCompareSpendOutcomeScatters all gain
// cabinet-anchor support without API changes — and the table is still
// reusable on /indicators/economy and /indicators/fiscal where no provider
// is present (election anchor preserved).

import { createContext, useContext } from "react";
import type { AsOf } from "./kpiSelectors";

// Imported from kpiSelectors directly (not via useElectionAsOf) to avoid a
// circular module graph — useElectionAsOf imports this context, so importing
// its type back here breaks HMR and produces opaque React render errors.
export type CompareAnchorOverride = {
  /** Quarterly anchor consumed by useElectionAsOf. `null` means "use the
   *  literal latest available point" — for an incumbent cabinet still in
   *  office, we want fresh data, not a stale tenure-end snapshot. */
  asOf: AsOf | null;
  /** Annual anchor consumed by useElectionYear. */
  year: number;
};

export const CompareAnchorContext = createContext<CompareAnchorOverride | null>(
  null,
);

/** Internal — the two election-anchor hooks check this first. */
export const useCompareAnchorOverride = (): CompareAnchorOverride | null =>
  useContext(CompareAnchorContext);
