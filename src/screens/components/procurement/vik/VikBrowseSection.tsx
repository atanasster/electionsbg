// Water enrichment strip for the sector browse pack (/procurement/contracts?
// sector=water). Renders the consolidated per-operator rollup as context ABOVE
// the filtered contracts table — scope-aware and over the SAME EIK-set the table
// filters on. See docs/plans/water-view-v1.md §4.3.
//
// Uses the lightweight `useVikGroupRollup` (ONE grouped aggregate) rather than
// the pack's full `useVik` fan-out (26+ per-EIK corpus downloads): the strip
// needs only the per-operator €/count, not the by-function model, so a single
// /api/db/awarder-group-rollup call replaces the fan-out. The by-function split
// stays on the awarder pack / the /water dashboard, which do load the corpus.

import { FC } from "react";
import { useVikGroupRollup } from "@/data/procurement/useVik";
import type { SectorBrowseSectionProps } from "../sectorPacks";
import { VikSubsidiaryTile } from "./VikSubsidiaryTile";

export const VikBrowseSection: FC<SectorBrowseSectionProps> = ({
  scope,
  eiks,
}) => {
  const { operators, isLoading } = useVikGroupRollup(eiks, scope);
  if (isLoading)
    return (
      <div className="h-[200px] animate-pulse rounded-xl border bg-card" />
    );
  if (!operators.length) return null;
  return <VikSubsidiaryTile operators={operators} />;
};
