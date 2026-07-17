// Data hook for the Околна среда (МОСВ) sector pack. The model comes from ONE
// /api/db/awarder-group-model call over the environment group EIKs — the server returns
// compact aggregates that buildEnvironmentModelFromAggregates folds into the identical
// EnvModel (see useAwarderGroupModel). Mirrors useTransport.tsx / useMvr.tsx.
//
// CONSOLIDATED GROUP — Министерство на околната среда и водите (000697371) is the
// principal of the МОСВ system: ИАОС (air/monitoring), the ПУДООС fund, the 3
// national-park directorates, НИМХ (meteo), the 4 river-basin directorates and the 16
// РИОСВ inspectorates. A pack mounted on the ministry that reported only the central
// EIK would understate the group (~€88M vs ~€227M), so on the ministry's page we
// aggregate parent + every subordinate. Mounted on any other EIK it stands alone.
//
// UNIVERSE FILTER — the agency (ИАОС) rivals the ministry, so the pack lets the reader
// isolate a universe (ministry / agency / fund / parks / basin / riosv / meteo). The
// active-universe model is its own (cached) group-model call over that EIK subset; the
// whole-group total (for the ИАОС share / footnote) comes from the parallel all-EIKs
// call — the same query when universe="all".

import { useMemo } from "react";
import { useAwarderGroupModel, type ScopeWindow } from "./useAwarderGroupModel";
import {
  buildEnvironmentModelFromAggregates,
  type EnvModel,
} from "@/lib/environmentAttributes";
import { useFundsAbsorption } from "@/data/funds/useFundsTaxonomy";
import {
  MOSV_EIK,
  ENV_ALIAS_EIKS,
  ENV_FUND_PROGRAM_CODES,
  envEntityByEik,
  envUniverseOf,
  type EnvUniverse,
} from "@/lib/environmentReferenceData";

export type { ScopeWindow };

/** Per-unit roll-up for the competition heatmap + awarders tile. */
export interface EnvUnitAgg {
  eik: string;
  name: string;
  universe: EnvUniverse | "";
  totalEur: number;
  contractCount: number;
  /** Single-bid share among contracts with a known tenderer count; null if none
   *  carry a count. Drives the competition heatmap. */
  singleBidShare: number | null;
  bidKnownN: number;
}

export interface EnvironmentData {
  model: EnvModel | null;
  /** Per-unit totals across the (universe-filtered) group, € desc. */
  units: EnvUnitAgg[];
  /** The EIKs actually aggregated for the active universe. */
  groupEiks: string[];
  /** Whole-group € (all universes) — for the ИАОС share / reconciliation footnote. */
  groupTotalEur: number;
  isLoading: boolean;
}

export const useEnvironment = (
  eik: string = MOSV_EIK,
  windowOverride?: ScopeWindow,
  universe: EnvUniverse | "all" = "all",
): EnvironmentData => {
  // The ministry consolidates its group; any other EIK stands alone.
  const allEiks = useMemo(
    () => (eik === MOSV_EIK ? [MOSV_EIK, ...ENV_ALIAS_EIKS] : [eik]),
    [eik],
  );

  // Which EIKs feed the active view. "all" = whole group; a universe id = just that
  // universe (ministry / agency / fund / parks / basin / riosv / meteo).
  const activeEiks = useMemo(() => {
    if (universe === "all") return allEiks;
    return allEiks.filter((e) => envUniverseOf(e) === universe);
  }, [allEiks, universe]);

  const isAll = universe === "all";

  // Active-universe model + its per-unit rollup.
  const active = useAwarderGroupModel(
    activeEiks,
    buildEnvironmentModelFromAggregates,
    windowOverride,
  );
  // Whole group — only for groupTotalEur (footnote + ИАОС-share denominator), which
  // must stay whole-group-invariant of the active universe filter. When universe="all"
  // the active call already IS the whole group, so skip this one.
  const whole = useAwarderGroupModel(
    allEiks,
    buildEnvironmentModelFromAggregates,
    windowOverride,
    !isAll,
  );

  const units = useMemo<EnvUnitAgg[]>(
    () =>
      active.byUnit
        .map((u) => {
          const ent = envEntityByEik(u.eik);
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
    groupTotalEur: isAll ? active.groupTotalEur : whole.groupTotalEur,
    isLoading: active.isLoading || (!isAll && whole.isLoading),
  };
};

// --- EU funds (ИСУН / ОП „Околна среда") ------------------------------------
// The environment programmes' absorption — contracted vs actually paid — joined by
// OP CODE (accurate), NOT the ВиК pack's EIK-sum. Filtered to ENV_FUND_PROGRAM_CODES.
// Not scope-windowed: EU-funds figures are programme-period lifetime totals.
//
// ⚠ SERVED FROM POSTGRES via the canonical `useFundsAbsorption()`
// (→ /api/db/fund-payload?kind=absorption). NEVER the static
// data/funds/derived/absorption.json: the ИСУН tree was migrated to Cloud SQL and
// `bucket:sync` EXCLUDES `^funds/.*`, so the bucket copies are unmaintained and go
// stale (measured: the bucket's muni-map.json was 15 days behind local).

export interface EnvFundProgramme {
  programCode: string;
  programName: string;
  period: string;
  contractedEur: number;
  paidEur: number;
  absorptionPct: number;
  contractCount: number;
}

export const useEnvironmentFunds = (): {
  funds: EnvFundProgramme[];
  isLoading: boolean;
} => {
  const { data, isLoading } = useFundsAbsorption();

  const funds = useMemo<EnvFundProgramme[]>(() => {
    const codes = new Set<string>(ENV_FUND_PROGRAM_CODES);
    return (data?.byProgramme ?? [])
      .filter((p) => codes.has(p.programCode))
      .sort((a, b) => b.contractedEur - a.contractedEur);
  }, [data]);

  return { funds, isLoading };
};
