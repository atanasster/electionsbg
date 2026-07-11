// Data hook for the Води (water) sector pack. Same shape as useVss: the buyer's
// full per-contract corpus comes from /api/db/awarder-contracts, is windowed
// CLIENT-SIDE to the host's [from, to) scope, then fed to the pure buildVikModel
// engine.
//
// CONSOLIDATED GROUP — why this pack fans out over many EIKs. Български ВиК
// холдинг ЕАД (206086428) is a 61-person parent; the procurement happens in its
// ~26 regional subsidiaries (each a separate awarder EIK). A pack mounted on the
// holding that reported only the parent would understate the group's procurement
// by orders of magnitude. So on the holding's page we fetch the parent + every
// believed subsidiary and merge before the model is built. Mounted on any other
// EIK (a single operator's own page) it stands alone. See
// docs/plans/water-view-v1.md §2/§4.3 and src/lib/vikReferenceData.ts.

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  awarderContractsQuery,
  scopeByWindow,
  type ScopeWindow,
} from "./useAwarderContracts";
import { useProcurementWindow } from "./useProcurementWindow";
import { buildVikModel, type VikModel } from "@/lib/vikAttributes";
import {
  VIK_HOLDING_EIK,
  VIK_HOLDING_SUB_EIKS,
  operatorByEik,
} from "@/lib/vikReferenceData";
import type { ProcurementContract } from "@/data/dataTypes";

export type { ScopeWindow };

/** Per-operator roll-up for the consolidated-group subsidiary tile. */
export interface VikOperatorAgg {
  eik: string;
  name: string;
  oblast: string;
  totalEur: number;
  contractCount: number;
}

export interface VikData {
  model: VikModel | null;
  /** Per-operator totals across the group, € desc (empty off the holding). */
  operators: VikOperatorAgg[];
  /** The EIKs actually aggregated (parent + subs on the holding, else [eik]). */
  groupEiks: string[];
  isLoading: boolean;
}

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

  const urlWindow = useProcurementWindow();
  const from = windowOverride ? windowOverride.from : urlWindow.from;
  const to = windowOverride ? windowOverride.to : urlWindow.to;

  // Keep `combine` MINIMAL — it re-runs whenever its identity changes (an inline
  // closure ⇒ every render), and react-query's replaceEqualDeep only stabilizes
  // the OUTPUT identities, it doesn't skip the body. So combine returns just the
  // stable arrays (whole-corpus rows + the raw per-query contract lists); the
  // expensive scope-windowed per-operator aggregation lives in a useMemo keyed on
  // those + from/to, so it recomputes only when the data or the window changes,
  // not on every hover-driven render.
  const { rows, perQuery, isLoading } = useQueries({
    queries: eiks.map((e) => awarderContractsQuery(e)),
    combine: (res) => {
      const anyLoaded = res.some((r) => r.data);
      return {
        rows: anyLoaded
          ? res.flatMap((r) => r.data?.contracts ?? [])
          : (null as ProcurementContract[] | null),
        perQuery: res.map((r) => r.data?.contracts ?? []),
        isLoading: res.some((r) => r.isLoading),
      };
    },
  });

  const operators = useMemo<VikOperatorAgg[]>(() => {
    if (!rows) return [];
    return eiks
      .map((e, i) => {
        const scoped = scopeByWindow(perQuery[i] ?? [], from, to).filter(
          (c) => c.tag === "contract",
        );
        const op = operatorByEik(e);
        let totalEur = 0;
        for (const c of scoped) totalEur += c.amountEur ?? 0;
        return {
          eik: e,
          name: op?.name ?? `ЕИК ${e}`,
          oblast: op?.oblast ?? "",
          totalEur,
          contractCount: scoped.length,
        };
      })
      .filter((o) => o.contractCount > 0)
      .sort((a, b) => b.totalEur - a.totalEur || a.eik.localeCompare(b.eik));
  }, [rows, perQuery, eiks, from, to]);

  const model = useMemo<VikModel | null>(() => {
    if (!rows) return null;
    return buildVikModel(scopeByWindow(rows, from, to));
  }, [rows, from, to]);

  return {
    model,
    operators,
    groupEiks: eiks,
    isLoading,
  };
};

/** Lightweight per-operator rollup for a SET of EIKs via ONE grouped aggregate
 *  (/api/db/awarder-group-rollup) — for the sector browse pack's context strip,
 *  which needs only the per-operator €/count (VikSubsidiaryTile), not the full
 *  corpus. Avoids the 26+-request fan-out `useVik` does for the pack's model. */
export const useVikGroupRollup = (
  eiks: readonly string[],
  windowOverride?: ScopeWindow,
): { operators: VikOperatorAgg[]; isLoading: boolean } => {
  const urlWindow = useProcurementWindow();
  const from = windowOverride ? windowOverride.from : urlWindow.from;
  const to = windowOverride ? windowOverride.to : urlWindow.to;
  const eikParam = useMemo(() => [...eiks].join(","), [eiks]);

  const { data, isLoading } = useQuery({
    queryKey: ["db", "awarder-group-rollup", eikParam, from, to] as const,
    queryFn: async (): Promise<{
      operators: { eik: string; contractCount: number; totalEur: number }[];
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
  const eikParam = useMemo(() => [...eiks].join(","), [eiks]);
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
