// Data hook for the Социално подпомагане (МТСП/АСП) sector pack. The model comes
// from ONE /api/db/awarder-group-model call over the 6 social budget units — the
// server returns compact aggregates that buildSocialModelFromAggregates folds into
// the identical SocialModel (see useAwarderGroupModel). Mirrors useMvr.tsx.
//
// CONSOLIDATED GROUP — Министерство на труда и социалната политика (000695395) is
// one of 6 social budget units that award ЗОП contracts (АСП, АЗ, ГИТ, АХУ, АКСУ).
// A pack mounted on the ministry that reported only the central EIK would understate
// the group (€82M vs ~€285M — АСП alone is €125M). So on the ministry's page we
// aggregate the parent + every subordinate. Mounted on any other EIK it stands alone.
//
// UNIVERSE FILTER — the pack passes an active `universe` (ministry / assistance /
// employment / …); the active-universe model is its own (cached) group-model call
// over that EIK subset, while the whole-group total (for the АСП share / footnote)
// comes from the parallel all-EIKs call — the same query when universe="all".

import { useMemo } from "react";
import { useAwarderGroupModel, type ScopeWindow } from "./useAwarderGroupModel";
import {
  buildSocialModelFromAggregates,
  type SocialModel,
} from "@/lib/socialAttributes";
import {
  SOCIAL_LEAD_EIK,
  SOCIAL_ALIAS_EIKS,
  ASP_EIK,
  socialEntityByEik,
  socialUniverseOf,
  type SocialUniverse,
} from "@/lib/socialReferenceData";

export type { ScopeWindow };

/** Per-unit roll-up for the competition heatmap + awarders tile. */
export interface SocialUnitAgg {
  eik: string;
  name: string;
  universe: SocialUniverse | "";
  totalEur: number;
  contractCount: number;
  /** Single-bid share among contracts with a known tenderer count; null if none
   *  carry a count. Drives the competition heatmap. */
  singleBidShare: number | null;
  bidKnownN: number;
}

export interface SocialData {
  model: SocialModel | null;
  /** Per-unit totals across the (universe-filtered) group, € desc. */
  units: SocialUnitAgg[];
  /** The EIKs actually aggregated for the active universe. */
  groupEiks: string[];
  /** Whole-group € (all universes) — for the АСП-share footnote / denominator. */
  groupTotalEur: number;
  /** АСП's share of the whole group's € (filter-invariant); null if no total. */
  aspShare: number | null;
  isLoading: boolean;
}

export const useSocial = (
  eik: string = SOCIAL_LEAD_EIK,
  windowOverride?: ScopeWindow,
  universe: SocialUniverse | "all" = "all",
): SocialData => {
  // The ministry consolidates its group; any other EIK stands alone.
  const allEiks = useMemo(
    () =>
      eik === SOCIAL_LEAD_EIK ? [SOCIAL_LEAD_EIK, ...SOCIAL_ALIAS_EIKS] : [eik],
    [eik],
  );

  // Which EIKs feed the active view. "all" = whole group; a universe id = just
  // that universe.
  const activeEiks = useMemo(() => {
    if (universe === "all") return allEiks;
    return allEiks.filter((e) => socialUniverseOf(e) === universe);
  }, [allEiks, universe]);

  const isAll = universe === "all";

  // Active-universe model + its per-unit rollup.
  const active = useAwarderGroupModel(
    activeEiks,
    buildSocialModelFromAggregates,
    windowOverride,
  );
  // Whole group — only for groupTotalEur (footnote + АСП-share denominator), which
  // must stay whole-group-invariant of the active universe filter. When
  // universe="all" the active call already IS the whole group, so skip this one.
  const whole = useAwarderGroupModel(
    allEiks,
    buildSocialModelFromAggregates,
    windowOverride,
    !isAll,
  );

  const units = useMemo<SocialUnitAgg[]>(
    () =>
      active.byUnit
        .map((u) => {
          const ent = socialEntityByEik(u.eik);
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

  // АСП's share of the WHOLE group (independent of the active filter) — from the
  // whole-group per-unit rollup (active when universe="all", else the dedicated call).
  const wholeUnits = isAll ? active.byUnit : whole.byUnit;
  const groupTotalEur = isAll ? active.groupTotalEur : whole.groupTotalEur;
  const aspShare = useMemo(() => {
    if (groupTotalEur <= 0) return null;
    const asp = wholeUnits.find((u) => u.eik === ASP_EIK);
    return asp ? asp.totalEur / groupTotalEur : null;
  }, [wholeUnits, groupTotalEur]);

  return {
    model: active.model,
    units,
    groupEiks: activeEiks,
    groupTotalEur,
    aspShare,
    isLoading: active.isLoading || (!isAll && whole.isLoading),
  };
};
