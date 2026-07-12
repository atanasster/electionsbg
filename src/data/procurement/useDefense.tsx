// Data hook for the Отбрана (defense / МО) sector pack. The model comes from ONE
// /api/db/awarder-group-model call over the МО budget units — the server returns
// compact aggregates that buildDefenseModelFromAggregates folds into the identical
// DefenseModel (see useAwarderGroupModel). This replaced a 25-request per-EIK
// fan-out that downloaded ~6 MB of raw contract rows to build the model client-side.
//
// CONSOLIDATED GROUP — Министерство на отбраната (000695324) is one of 25 МО
// budget units that award ЗОП contracts (the army commands, ВМА, the academies,
// the military clubs …). A pack mounted on the ministry that reported only the
// central EIK would understate the group's procurement (€852M vs €2.33bn). So on
// the ministry's page we aggregate the parent + every subordinate. Mounted on any
// other EIK it stands alone.
//
// UNIVERSE FILTER — ВМА (health) is ~47% of the group's value and buys drugs, so
// a whole-group view reads as medicines. The pack passes an active `universe`;
// the active-universe model is its own (cached) group-model call over that EIK
// subset, while the whole-group total (for the ВМА share / footnote) comes from
// the parallel all-EIKs call — the same query when universe="all". See
// docs/plans/defense-pack-v1.md §2/§Part-12.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useProcurementWindow } from "./useProcurementWindow";
import { useAwarderGroupModel, type ScopeWindow } from "./useAwarderGroupModel";
import {
  buildDefenseModelFromAggregates,
  type DefenseModel,
} from "@/lib/defenseAttributes";
import {
  MOD_EIK,
  DEFENSE_ALIAS_EIKS,
  entityByEik,
  universeOf,
  type DefenseUniverse,
} from "@/lib/defenseReferenceData";

export type { ScopeWindow };

/** Per-unit roll-up for the competition heatmap + awarders tile. */
export interface DefenseUnitAgg {
  eik: string;
  name: string;
  universe: DefenseUniverse | "";
  totalEur: number;
  contractCount: number;
  /** Single-bid share among contracts with a known tenderer count; null if
   *  none carry a count. Drives the competition heatmap. */
  singleBidShare: number | null;
  bidKnownN: number;
}

export interface DefenseData {
  model: DefenseModel | null;
  /** Per-unit totals across the (universe-filtered) group, € desc. */
  units: DefenseUnitAgg[];
  /** The EIKs actually aggregated for the active universe. */
  groupEiks: string[];
  /** Whole-group € (all universes) — for the reconciliation footnote / ВМА share. */
  groupTotalEur: number;
  isLoading: boolean;
}

export const useDefense = (
  eik: string = MOD_EIK,
  windowOverride?: ScopeWindow,
  universe: DefenseUniverse | "all" | "no_vma" = "all",
): DefenseData => {
  // The ministry consolidates its group; any other EIK stands alone.
  const allEiks = useMemo(
    () => (eik === MOD_EIK ? [MOD_EIK, ...DEFENSE_ALIAS_EIKS] : [eik]),
    [eik],
  );

  // Which EIKs feed the active view. "all" = whole group; "no_vma" = drop ВМА;
  // a universe id = just that universe.
  const activeEiks = useMemo(() => {
    if (universe === "all") return allEiks;
    if (universe === "no_vma")
      return allEiks.filter((e) => universeOf(e) !== "health");
    return allEiks.filter((e) => universeOf(e) === universe);
  }, [allEiks, universe]);

  const isAll = universe === "all";

  // Active-universe model + its per-unit rollup.
  const active = useAwarderGroupModel(
    activeEiks,
    buildDefenseModelFromAggregates,
    windowOverride,
  );
  // Whole group — only for groupTotalEur (footnote + ВМА-share denominator),
  // which must stay whole-group-invariant of the active universe filter. When
  // universe="all" the active call already IS the whole group, so skip this one.
  const whole = useAwarderGroupModel(
    allEiks,
    buildDefenseModelFromAggregates,
    windowOverride,
    !isAll,
  );

  const units = useMemo<DefenseUnitAgg[]>(
    () =>
      active.byUnit
        .map((u) => {
          const ent = entityByEik(u.eik);
          return {
            eik: u.eik,
            name: ent?.name ?? `ЕИК ${u.eik}`,
            universe: ent?.universe ?? ("" as const),
            totalEur: u.totalEur,
            contractCount: u.contractCount,
            singleBidShare: u.bidKnownN > 0 ? u.singleBidN / u.bidKnownN : null,
            bidKnownN: u.bidKnownN,
          };
        })
        .filter((u) => u.contractCount > 0)
        .sort((a, b) => b.totalEur - a.totalEur || a.eik.localeCompare(b.eik)),
    [active.byUnit],
  );

  return {
    model: active.model,
    units,
    groupEiks: activeEiks,
    // When universe="all" the active call is the whole group; else use the
    // dedicated whole-group call (the ВМА-share denominator is filter-invariant).
    groupTotalEur: isAll ? active.groupTotalEur : whole.groupTotalEur,
    isLoading: active.isLoading || (!isAll && whole.isLoading),
  };
};

/** Lightweight per-unit rollup for a SET of EIKs via ONE grouped aggregate
 *  (/api/db/awarder-group-rollup) — for the sector browse strip, which needs only
 *  the per-unit €/count/single-bid, not the full corpus. Avoids the 25-request
 *  fan-out `useDefense` does for the pack's model. Mirrors `useVikGroupRollup`. */
export const useDefenseGroupRollup = (
  eiks: readonly string[],
  windowOverride?: ScopeWindow,
): { units: DefenseUnitAgg[]; isLoading: boolean } => {
  const urlWindow = useProcurementWindow();
  const from = windowOverride ? windowOverride.from : urlWindow.from;
  const to = windowOverride ? windowOverride.to : urlWindow.to;
  const eikParam = useMemo(() => [...eiks].join(","), [eiks]);

  const { data, isLoading } = useQuery({
    queryKey: [
      "db",
      "awarder-group-rollup",
      "defense",
      eikParam,
      from,
      to,
    ] as const,
    queryFn: async (): Promise<{
      operators: {
        eik: string;
        contractCount: number;
        totalEur: number;
        bidKnownN: number;
        singleBidN: number;
      }[];
    }> => {
      const p = new URLSearchParams({ eiks: eikParam });
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      const r = await fetch(`/api/db/awarder-group-rollup?${p.toString()}`);
      if (!r.ok) return { operators: [] };
      return r.json();
    },
    enabled: eiks.length > 0,
    staleTime: Infinity,
  });

  const units = useMemo<DefenseUnitAgg[]>(
    () =>
      (data?.operators ?? [])
        .map((o) => {
          const ent = entityByEik(o.eik);
          return {
            eik: o.eik,
            name: ent?.name ?? `ЕИК ${o.eik}`,
            universe: ent?.universe ?? ("" as const),
            totalEur: o.totalEur,
            contractCount: o.contractCount,
            singleBidShare: o.bidKnownN > 0 ? o.singleBidN / o.bidKnownN : null,
            bidKnownN: o.bidKnownN,
          };
        })
        .sort((a, b) => b.totalEur - a.totalEur || a.eik.localeCompare(b.eik)),
    [data],
  );

  return { units, isLoading };
};
