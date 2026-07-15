// Data hook for the Полиция / МВР sector pack. The model comes from ONE
// /api/db/awarder-group-model call over the МВР budget units — the server returns
// compact aggregates that buildSecurityModelFromAggregates folds into the identical
// SecurityModel (see useAwarderGroupModel). Mirrors useDefense.tsx.
//
// CONSOLIDATED GROUP — Министерство на вътрешните работи (000695235) is one of 74
// МВР budget units that award ЗОП contracts (ГД Гранична полиция, ГД Национална
// полиция, 28 ОДМВР, ГДПБЗН + РДПБЗН, Медицински институт, ДУССД …). A pack mounted
// on the ministry that reported only the central EIK would understate the group's
// procurement (€665M vs ~€1.9bn). So on the ministry's page we aggregate the parent
// + every subordinate. Mounted on any other EIK it stands alone.
//
// UNIVERSE FILTER — the Медицински институт (health) buys drugs, so a whole-group
// view reads partly as medicines. The pack passes an active `universe`; the
// active-universe model is its own (cached) group-model call over that EIK subset,
// while the whole-group total (for the health share / footnote) comes from the
// parallel all-EIKs call — the same query when universe="all".

import { useMemo } from "react";
import { useAwarderGroupModel, type ScopeWindow } from "./useAwarderGroupModel";
import {
  buildSecurityModelFromAggregates,
  type SecurityModel,
} from "@/lib/securityAttributes";
import {
  MVR_EIK,
  SECURITY_ALIAS_EIKS,
  securityEntityByEik,
  securityUniverseOf,
  type SecurityUniverse,
} from "@/lib/securityReferenceData";

export type { ScopeWindow };

/** Per-unit roll-up for the competition heatmap + awarders tile. */
export interface MvrUnitAgg {
  eik: string;
  name: string;
  universe: SecurityUniverse | "";
  totalEur: number;
  contractCount: number;
  /** Single-bid share among contracts with a known tenderer count; null if
   *  none carry a count. Drives the competition heatmap. */
  singleBidShare: number | null;
  bidKnownN: number;
}

export interface MvrData {
  model: SecurityModel | null;
  /** Per-unit totals across the (universe-filtered) group, € desc. */
  units: MvrUnitAgg[];
  /** The EIKs actually aggregated for the active universe. */
  groupEiks: string[];
  /** Whole-group € (all universes) — for the reconciliation footnote / health share. */
  groupTotalEur: number;
  isLoading: boolean;
}

export const useMvr = (
  eik: string = MVR_EIK,
  windowOverride?: ScopeWindow,
  universe: SecurityUniverse | "all" | "no_health" = "all",
): MvrData => {
  // The ministry consolidates its group; any other EIK stands alone.
  const allEiks = useMemo(
    () => (eik === MVR_EIK ? [MVR_EIK, ...SECURITY_ALIAS_EIKS] : [eik]),
    [eik],
  );

  // Which EIKs feed the active view. "all" = whole group; "no_health" = drop the
  // Медицински институт; a universe id = just that universe.
  const activeEiks = useMemo(() => {
    if (universe === "all") return allEiks;
    if (universe === "no_health")
      return allEiks.filter((e) => securityUniverseOf(e) !== "health");
    return allEiks.filter((e) => securityUniverseOf(e) === universe);
  }, [allEiks, universe]);

  const isAll = universe === "all";

  // Active-universe model + its per-unit rollup.
  const active = useAwarderGroupModel(
    activeEiks,
    buildSecurityModelFromAggregates,
    windowOverride,
  );
  // Whole group — only for groupTotalEur (footnote + health-share denominator),
  // which must stay whole-group-invariant of the active universe filter. When
  // universe="all" the active call already IS the whole group, so skip this one.
  const whole = useAwarderGroupModel(
    allEiks,
    buildSecurityModelFromAggregates,
    windowOverride,
    !isAll,
  );

  const units = useMemo<MvrUnitAgg[]>(
    () =>
      active.byUnit
        .map((u) => {
          const ent = securityEntityByEik(u.eik);
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
    // dedicated whole-group call (the health-share denominator is filter-invariant).
    groupTotalEur: isAll ? active.groupTotalEur : whole.groupTotalEur,
    isLoading: active.isLoading || (!isAll && whole.isLoading),
  };
};

// (No group-rollup helper here — the sector browse strip for МВР is filter-only in
// v1. Add a useMvrGroupRollup mirror of useDefenseGroupRollup if a browse Section
// is built, per the plan.)
