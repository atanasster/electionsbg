// Shared data hook for the consolidated sector packs (Води/ВСС/Отбрана/НОИ/
// НЗОК/Култура). ONE /api/db/awarder-group-model call returns the compact
// aggregates that a pack's `buildXxxModelFromAggregates` folds into the identical
// AwarderModel — replacing the 25+-request `awarder-contracts` fan-out (which
// downloaded every contract row, megabytes, to build the model in the browser).
//
// The pack passes its OWN builder (which closes over its private classifier), so
// CPV→category classification stays each pack's single source of truth; this hook
// only owns the fetch, the scope window, and the raw per-unit aggregates.
//
// Scope window: [from, to) resolved from an explicit override else the URL scope
// (useScopeWindow) — same rule as the old per-pack hooks.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import type { ScopeWindow } from "./useAwarderContracts";
import type { AwarderModel, GroupModelPayload } from "@/lib/awarderModel";

export type { ScopeWindow };

/** Raw per-budget-unit rollup (one row per awarder EIK in the group) — the packs
 *  map this to their operator/unit shape (name/oblast lookup) client-side. */
export interface GroupUnitAgg {
  eik: string;
  totalEur: number;
  contractCount: number;
  bidKnownN: number;
  singleBidN: number;
}

export interface GroupModelResult<Cat extends string> {
  model: AwarderModel<Cat> | null;
  /** Per-unit totals for the whole group (independent of any client filter). */
  byUnit: GroupUnitAgg[];
  /** Whole-group € across every unit — for reconciliation footnotes / shares. */
  groupTotalEur: number;
  isLoading: boolean;
  isError: boolean;
}

const EMPTY_UNITS: GroupUnitAgg[] = [];

export const useAwarderGroupModel = <Cat extends string>(
  eiks: readonly string[],
  buildModel: (p: GroupModelPayload) => AwarderModel<Cat>,
  windowOverride?: ScopeWindow,
  // Callers that fetch a second (whole-group) instance can disable it when it
  // would duplicate the primary call — see useDefense's universe filter.
  enabled = true,
): GroupModelResult<Cat> => {
  const urlWindow = useScopeWindow();
  const from = windowOverride ? windowOverride.from : urlWindow.from;
  const to = windowOverride ? windowOverride.to : urlWindow.to;
  const eikParam = useMemo(() => [...eiks].join(","), [eiks]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["db", "awarder-group-model", eikParam, from, to] as const,
    queryFn: async (): Promise<GroupModelPayload | null> => {
      const pr = new URLSearchParams({ eiks: eikParam });
      if (from) pr.set("from", from);
      if (to) pr.set("to", to);
      const r = await fetch(`/api/db/awarder-group-model?${pr.toString()}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: enabled && eiks.length > 0,
    staleTime: Infinity,
  });

  const model = useMemo<AwarderModel<Cat> | null>(
    () => (data ? buildModel(data) : null),
    [data, buildModel],
  );

  const byUnit = data?.byUnit ?? EMPTY_UNITS;
  const groupTotalEur = useMemo(
    () => byUnit.reduce((a, u) => a + (u.totalEur ?? 0), 0),
    [byUnit],
  );

  return { model, byUnit, groupTotalEur, isLoading, isError };
};
