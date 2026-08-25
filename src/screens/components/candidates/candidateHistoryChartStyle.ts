// Pulled out of CandidateHistoryChart.tsx so that file can keep exporting only its
// component (react-refresh) and so this decision is directly unit-testable — recharts'
// SVG output needs a measured layout jsdom doesn't provide, which is why this codebase's
// other chart tests (PersonWealthTrajectory.test.tsx) don't assert on rendered bar
// attributes either.

/** How one bar's Cell should render, given which region-within-cycle it is (`n`) and
 *  whether its cycle (`entryDate`) is the one `highlightDate` names.
 *
 *  ⚠️ `n === 0` is NOT the top (highest-vote) region — CandidateHistoryChart sorts each
 *  cycle's `preferences` ASCENDING before this is called, so `n === 0` is the region with
 *  the FEWEST preferences that cycle and the last index is the strongest. That sort
 *  predates this function (pre-existing, unchanged here); this is only documenting it so
 *  a future reader doesn't assume the opposite from the `n === 0 ? 1 : 0.55` weighting.
 *
 *  `highlightDate === undefined` (the legacy /candidate/:id single-snapshot path, which
 *  has no cycle selector) treats every cycle as current — the pre-existing behaviour,
 *  unchanged. */
export const barCellStyle = (
  n: number,
  entryDate: string,
  entryColor: string | undefined,
  highlightDate: string | undefined,
): { fillOpacity: number; stroke: string | undefined; strokeWidth: number } => {
  const isCurrent = highlightDate === undefined || entryDate === highlightDate;
  const highlighted = isCurrent && highlightDate !== undefined;
  return {
    fillOpacity: isCurrent ? (n === 0 ? 1 : 0.55) : n === 0 ? 0.35 : 0.2,
    stroke: highlighted ? entryColor : undefined,
    strokeWidth: highlighted ? 1.5 : 0,
  };
};
