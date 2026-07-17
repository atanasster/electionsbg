// Data hook for the Регионално развитие (МРРБ) sector pack. The model comes from ONE
// /api/db/awarder-group-model call over the МРРБ group EIKs — the server returns
// compact aggregates that buildRegionalModelFromAggregates folds into the identical
// RegionalModel (see useAwarderGroupModel). Mirrors useEnvironment.tsx / useTransport.tsx.
//
// CONSOLIDATED GROUP — Министерство на регионалното развитие и благоустройството
// (831661388) is the principal of a group that also awards ЗОП through the cadastre
// agency (АГКК), the building-control directorate (ДНСК) and the 27 областни
// администрации (regional governors). A pack mounted on the ministry that reported
// only the central EIK would understate the group (~€100M vs ~€213M), so on the
// ministry's page we aggregate parent + every subordinate. Mounted on any other EIK
// it stands alone.
//
// UNIVERSE FILTER — cadastre (АГКК) rivals the ministry, and the 27 governors are a
// confound (regional-office operations, not МРРБ HQ procurement), so the pack lets the
// reader isolate a universe (ministry / cadastre / control / governors). The active-
// universe model is its own (cached) group-model call over that EIK subset; the whole-
// group total (for shares / the footnote) comes from the parallel all-EIKs call — the
// same query when universe="all".
//
// ⚠ ROADS (АПИ) and WATER (ВиК) ARE SEPARATE SECTORS — not in this group (see
// regionalReferenceData.ts); the pack cross-links to /sector/roads and /water instead.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAwarderGroupModel, type ScopeWindow } from "./useAwarderGroupModel";
import {
  buildRegionalModelFromAggregates,
  type RegionalModel,
} from "@/lib/regionalAttributes";
import { dataUrl } from "@/data/dataUrl";
import {
  REGIONAL_EIK,
  REGIONAL_ALIAS_EIKS,
  REGIONAL_COHESION_PROGRAMS,
  regionalEntityByEik,
  regionalUniverseOf,
  type RegionalUniverse,
} from "@/lib/regionalReferenceData";

export type { ScopeWindow };

/** Per-unit roll-up for the competition heatmap + awarders tile. */
export interface RegionalUnitAgg {
  eik: string;
  name: string;
  universe: RegionalUniverse | "";
  totalEur: number;
  contractCount: number;
  /** Single-bid share among contracts with a known tenderer count; null if none
   *  carry a count. Drives the competition heatmap. */
  singleBidShare: number | null;
  bidKnownN: number;
}

export interface RegionalData {
  model: RegionalModel | null;
  /** Per-unit totals across the (universe-filtered) group, € desc. */
  units: RegionalUnitAgg[];
  /** The EIKs actually aggregated for the active universe. */
  groupEiks: string[];
  /** Whole-group € (all universes) — for shares / the reconciliation footnote. */
  groupTotalEur: number;
  isLoading: boolean;
}

export const useRegional = (
  eik: string = REGIONAL_EIK,
  windowOverride?: ScopeWindow,
  universe: RegionalUniverse | "all" = "all",
): RegionalData => {
  // The ministry consolidates its group; any other EIK stands alone.
  const allEiks = useMemo(
    () =>
      eik === REGIONAL_EIK ? [REGIONAL_EIK, ...REGIONAL_ALIAS_EIKS] : [eik],
    [eik],
  );

  // Which EIKs feed the active view. "all" = whole group; a universe id = just that
  // universe (ministry / cadastre / control / governors).
  const activeEiks = useMemo(() => {
    if (universe === "all") return allEiks;
    return allEiks.filter((e) => regionalUniverseOf(e) === universe);
  }, [allEiks, universe]);

  const isAll = universe === "all";

  // Active-universe model + its per-unit rollup.
  const active = useAwarderGroupModel(
    activeEiks,
    buildRegionalModelFromAggregates,
    windowOverride,
  );
  // Whole group — only for groupTotalEur (footnote + share denominator), which must
  // stay whole-group-invariant of the active universe filter. When universe="all" the
  // active call already IS the whole group, so skip this one.
  const whole = useAwarderGroupModel(
    allEiks,
    buildRegionalModelFromAggregates,
    windowOverride,
    !isAll,
  );

  const units = useMemo<RegionalUnitAgg[]>(
    () =>
      active.byUnit
        .map((u) => {
          const ent = regionalEntityByEik(u.eik);
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

// --- EU cohesion (ИСУН / ОПРР + „Развитие на регионите") --------------------
// The МРРБ-managed regional cohesion programmes' absorption — contracted vs actually
// paid — joined by OP CODE (accurate), read straight from the static
// data/funds/derived/absorption.json byProgramme[] (mirrors useEnvironmentFunds; there
// is NO useFundsAbsorption hook), filtered to REGIONAL_COHESION_PROGRAMS. No server
// call. Not scope-windowed: cohesion figures are programme-period lifetime totals, and
// the beneficiaries are the municipalities, not the МРРБ group EIKs — so this is NOT an
// awarder-funds-rollup by our own EIKs, it is the two OP programmes by code.

export interface RegionalCohesionProgramme {
  programCode: string;
  programName: string;
  period: string;
  contractedEur: number;
  paidEur: number;
  absorptionPct: number;
  contractCount: number;
}

interface AbsorptionFile {
  byProgramme?: RegionalCohesionProgramme[];
}

export const useRegionalCohesion = (): {
  programmes: RegionalCohesionProgramme[];
  isLoading: boolean;
} => {
  const { data, isLoading } = useQuery({
    queryKey: ["funds", "absorption", "regional"] as const,
    queryFn: async (): Promise<AbsorptionFile> => {
      const r = await fetch(dataUrl("/funds/derived/absorption.json"));
      if (!r.ok) return {};
      return r.json();
    },
    staleTime: Infinity,
  });

  const programmes = useMemo<RegionalCohesionProgramme[]>(() => {
    const codes = new Set<string>(REGIONAL_COHESION_PROGRAMS);
    return (
      (data?.byProgramme ?? [])
        .filter((p) => codes.has(p.programCode))
        // Newest programme first (2021-27 ahead of 2014-20) — the absorption-risk
        // story leads.
        .sort((a, b) => b.period.localeCompare(a.period))
    );
  }, [data]);

  return { programmes, isLoading };
};
