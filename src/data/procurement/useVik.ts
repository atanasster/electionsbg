// Data hook for the Води (water) sector pack. Same shape as useVss: the buyer's
// full per-contract corpus comes from /api/db/awarder-contracts, is windowed
// CLIENT-SIDE to the host's [from, to) scope, then fed to the pure buildVikModel
// engine.
//
// CONSOLIDATED GROUP — why this pack fans out over many EIKs. Български ВиК
// холдинг ЕАД (206086428) is a 61-person parent; the procurement happens in its
// regional subsidiaries (each a separate awarder EIK). A pack mounted on the
// holding that reported only the parent would understate the group's procurement
// by orders of magnitude. So on the holding's page we fetch the parent + every
// believed subsidiary and merge before the model is built. Mounted on any other
// EIK (a single operator's own page) it stands alone. See
// docs/plans/water-view-v1.md §2/§4.3 and src/lib/vikReferenceData.ts.
//
// ⚠ TWO UNIVERSES, AND THEY ARE NOT THE SAME QUESTION. `useVik` answers "what
// does Български ВиК холдинг's GROUP buy" and is for /awarder/206086428, whose
// subject is that legal entity. `useWaterSector` below answers "what does the
// water SECTOR buy" and is for /water, whose subject is the country's water
// procurement — concession, irrigation, dams and municipal operators included.
// The sector is the strict superset; the difference is dominated by Софийска
// вода, which is a Veolia concession and never a holding company. The size of
// that gap is a corpus figure, so it is pinned in sector_stats.data.test.ts
// rather than written here, where it would go stale unnoticed.
//
// The /water page used to call `useVik`, so its five tiles counted 26 EIKs while
// the hub tile linking to it, the map above it and the search box beside it all
// counted the full sector — the same page showing Софийска вода as a pin and
// omitting it from every number underneath. That is the split these two hooks
// exist to keep apart; see docs/plans/water-sector-audit-v1.md.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import {
  useAwarderGroupModel,
  useEikParam,
  type ScopeWindow,
} from "./useAwarderGroupModel";
import {
  buildVikModelFromAggregates,
  type VikModel,
} from "@/lib/vikAttributes";
import {
  VIK_HOLDING_EIK,
  VIK_HOLDING_SUB_EIKS,
  WATER_SECTOR_EIKS,
  operatorByEik,
} from "@/lib/vikReferenceData";

export type { ScopeWindow };

/** Per-operator roll-up for the consolidated-group subsidiary tile. */
export interface VikOperatorAgg {
  eik: string;
  name: string;
  oblast: string;
  totalEur: number;
  contractCount: number;
  /** Single-bid share among contracts with a known tenderer count; null if
   *  none carry a count. Drives the competition heatmap. */
  singleBidShare: number | null;
  bidKnownN: number;
}

export interface VikData {
  model: VikModel | null;
  /** Per-operator totals across the aggregated set, € desc. */
  operators: VikOperatorAgg[];
  /** The EIKs actually aggregated — the holding group, one EIK, or the whole
   *  sector, depending on which hook you called. Referentially STABLE across
   *  renders (see the return site), so it is safe in a memo or a query key, and
   *  `readonly` so a consumer cannot mutate the shared constant it may be. */
  groupEiks: readonly string[];
  isLoading: boolean;
}

/** The shared body — model + per-operator rollup over an EXPLICIT EIK set.
 *
 *  One `/api/db/awarder-group-model` call keyed on the joined list, so widening
 *  the set costs a longer query string rather than a request per EIK.
 *
 *  IDENTITY CONTRACT: `eiks` must be referentially stable across renders — a
 *  memo, or a module constant. It is returned as `groupEiks` and joined into a
 *  React Query key, so a caller building the array inline would re-key on every
 *  render. Both exported wrappers below satisfy this; a new one must too. */
const useVikOver = (
  eiks: readonly string[],
  windowOverride?: ScopeWindow,
): VikData => {
  const gm = useAwarderGroupModel(
    eiks,
    buildVikModelFromAggregates,
    windowOverride,
  );

  const operators = useMemo<VikOperatorAgg[]>(
    () =>
      gm.byUnit
        .map((u) => {
          const op = operatorByEik(u.eik);
          return {
            eik: u.eik,
            name: op?.name ?? `ЕИК ${u.eik}`,
            oblast: op?.oblast ?? "",
            totalEur: u.totalEur,
            contractCount: u.contractCount,
            singleBidShare: u.bidKnownN > 0 ? u.singleBidN / u.bidKnownN : null,
            bidKnownN: u.bidKnownN,
          };
        })
        .filter((o) => o.contractCount > 0)
        .sort((a, b) => b.totalEur - a.totalEur || a.eik.localeCompare(b.eik)),
    [gm.byUnit],
  );

  // `eiks` is returned AS GIVEN, never copied: `useVik` memoises it and
  // `useWaterSector` passes a module constant, so consumers that feed it into a
  // `useMemo`/query key (useVikFunds joins it) keep a stable identity. A defensive
  // `[...eiks]` here would be a fresh array every render and defeat that.
  return {
    model: gm.model,
    operators,
    groupEiks: eiks,
    isLoading: gm.isLoading,
  };
};

/** Български ВиК холдинг's GROUP — the parent plus its believed subsidiaries.
 *  Mounted on /awarder/206086428, whose subject is that legal entity; any other
 *  EIK stands alone. NOT the water sector — see the header. */
export const useVik = (
  eik: string = VIK_HOLDING_EIK,
  windowOverride?: ScopeWindow,
): VikData => {
  // The holding consolidates its group; any other EIK stands alone.
  const eiks = useMemo(
    () =>
      eik === VIK_HOLDING_EIK
        ? [VIK_HOLDING_EIK, ...VIK_HOLDING_SUB_EIKS]
        : [eik],
    [eik],
  );
  return useVikOver(eiks, windowOverride);
};

/** The whole water SECTOR — every row in WATER_OPERATORS, which is the same set
 *  the /governance/sectors headline, the operator map, the search box, the browse
 *  pack and /water/operators use. This is what /water renders, so those surfaces
 *  cannot report different totals for the same page. */
export const useWaterSector = (windowOverride?: ScopeWindow): VikData =>
  // WATER_SECTOR_EIKS is a module constant, so its identity is already stable.
  useVikOver(WATER_SECTOR_EIKS, windowOverride);

/** Lightweight per-operator rollup for a SET of EIKs via ONE grouped aggregate
 *  (/api/db/awarder-group-rollup) — for the sector browse pack's context strip,
 *  which needs only the per-operator €/count (VikSubsidiaryTile), not the full
 *  by-function model the group-model call also builds. */
export const useVikGroupRollup = (
  eiks: readonly string[],
  windowOverride?: ScopeWindow,
): { operators: VikOperatorAgg[]; isLoading: boolean } => {
  const urlWindow = useScopeWindow();
  const from = windowOverride ? windowOverride.from : urlWindow.from;
  const to = windowOverride ? windowOverride.to : urlWindow.to;
  const eikParam = useEikParam(eiks);

  const { data, isLoading } = useQuery({
    queryKey: ["db", "awarder-group-rollup", eikParam, from, to] as const,
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

  const operators = useMemo<VikOperatorAgg[]>(
    () =>
      (data?.operators ?? []).map((o) => {
        const op = operatorByEik(o.eik);
        return {
          eik: o.eik,
          name: op?.name ?? `ЕИК ${o.eik}`,
          oblast: op?.oblast ?? "",
          totalEur: o.totalEur,
          contractCount: o.contractCount,
          singleBidShare: o.bidKnownN > 0 ? o.singleBidN / o.bidKnownN : null,
          bidKnownN: o.bidKnownN,
        };
      }),
    [data],
  );

  return { operators, isLoading };
};

/** One EU-fund (ИСУН) row per operator across a set of EIKs — contracted vs paid
 *  (absorption), from the already-rolled fund_beneficiaries table via ONE call.
 *  Not scope-windowed: EU-funds figures are programme-period lifetime totals. */
export interface VikFundOp {
  eik: string;
  name: string;
  oblast: string;
  contractedEur: number;
  paidEur: number;
  projectCount: number;
}

export const useVikFunds = (
  eiks: readonly string[],
): { funds: VikFundOp[]; isLoading: boolean } => {
  const eikParam = useEikParam(eiks);
  const { data, isLoading } = useQuery({
    queryKey: ["db", "awarder-funds-rollup", eikParam] as const,
    queryFn: async (): Promise<{
      operators: {
        eik: string;
        contractedEur: number;
        paidEur: number;
        projectCount: number;
      }[];
    }> => {
      const r = await fetch(
        `/api/db/awarder-funds-rollup?eiks=${encodeURIComponent(eikParam)}`,
      );
      if (!r.ok) return { operators: [] };
      return r.json();
    },
    enabled: eiks.length > 0,
    staleTime: Infinity,
  });

  const funds = useMemo<VikFundOp[]>(
    () =>
      (data?.operators ?? []).map((o) => {
        const op = operatorByEik(o.eik);
        return {
          eik: o.eik,
          name: op?.name ?? `ЕИК ${o.eik}`,
          oblast: op?.oblast ?? "",
          contractedEur: o.contractedEur,
          paidEur: o.paidEur,
          projectCount: o.projectCount,
        };
      }),
    [data],
  );

  return { funds, isLoading };
};
