// Data hook for the Транспорт sector pack. The model comes from ONE
// /api/db/awarder-group-model call over the transport group EIKs — the server returns
// compact aggregates that buildTransportModelFromAggregates folds into the identical
// TransportModel (see useAwarderGroupModel). Mirrors useMvr.tsx / useDefense.tsx.
//
// CONSOLIDATED GROUP — Министерство на транспорта и съобщенията (000695388) is the
// principal of a group that also awards ЗОП contracts through the rail companies
// (НКЖИ, БДЖ холдинг/пътнически/товарни), the port-infrastructure company, and the
// maritime/aviation/road-transport/rail regulators. A pack mounted on the ministry
// that reported only the central EIK would understate the group (€2.2bn vs ~€5.9bn),
// so on the ministry's page we aggregate the parent + every subordinate. Mounted on
// any other EIK it stands alone.
//
// UNIVERSE FILTER — rail dominates the group (НКЖИ + БДЖ), so the pack lets the reader
// isolate a mode (rail / maritime / aviation / road / ministry). The active-universe
// model is its own (cached) group-model call over that EIK subset; the whole-group
// total (for the rail share / footnote) comes from the parallel all-EIKs call — the
// same query when universe="all".
//
// ⚠ ROADS ARE A SEPARATE SECTOR — АПИ/Автомагистрали are NOT in this group (see
// transportReferenceData.ts); the pack links out to /sector/roads instead.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAwarderGroupModel, type ScopeWindow } from "./useAwarderGroupModel";
import {
  buildTransportModelFromAggregates,
  type TransportModel,
} from "@/lib/transportAttributes";
import {
  TRANSPORT_EIK,
  TRANSPORT_ALIAS_EIKS,
  transportEntityByEik,
  transportUniverseOf,
  type TransportUniverse,
} from "@/lib/transportReferenceData";

export type { ScopeWindow };

/** Per-unit roll-up for the competition heatmap, mode split + awarders tile. */
export interface TransportUnitAgg {
  eik: string;
  name: string;
  universe: TransportUniverse | "";
  totalEur: number;
  contractCount: number;
  /** Single-bid share among contracts with a known tenderer count; null if none
   *  carry a count. Drives the competition heatmap. */
  singleBidShare: number | null;
  bidKnownN: number;
}

export interface TransportData {
  model: TransportModel | null;
  /** Per-unit totals across the (universe-filtered) group, € desc. */
  units: TransportUnitAgg[];
  /** The EIKs actually aggregated for the active universe. */
  groupEiks: string[];
  /** Whole-group € (all universes) — for the reconciliation footnote / rail share. */
  groupTotalEur: number;
  isLoading: boolean;
}

export const useTransport = (
  eik: string = TRANSPORT_EIK,
  windowOverride?: ScopeWindow,
  universe: TransportUniverse | "all" = "all",
): TransportData => {
  // The ministry consolidates its group; any other EIK stands alone.
  const allEiks = useMemo(
    () =>
      eik === TRANSPORT_EIK ? [TRANSPORT_EIK, ...TRANSPORT_ALIAS_EIKS] : [eik],
    [eik],
  );

  // Which EIKs feed the active view. "all" = whole group; a universe id = just that
  // universe (ministry / rail / maritime / aviation / road).
  const activeEiks = useMemo(() => {
    if (universe === "all") return allEiks;
    return allEiks.filter((e) => transportUniverseOf(e) === universe);
  }, [allEiks, universe]);

  const isAll = universe === "all";

  // Active-universe model + its per-unit rollup.
  const active = useAwarderGroupModel(
    activeEiks,
    buildTransportModelFromAggregates,
    windowOverride,
  );
  // Whole group — only for groupTotalEur (footnote + rail-share denominator), which
  // must stay whole-group-invariant of the active universe filter. When universe="all"
  // the active call already IS the whole group, so skip this one.
  const whole = useAwarderGroupModel(
    allEiks,
    buildTransportModelFromAggregates,
    windowOverride,
    !isAll,
  );

  const units = useMemo<TransportUnitAgg[]>(
    () =>
      active.byUnit
        .map((u) => {
          const ent = transportEntityByEik(u.eik);
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
    // When universe="all" the active call is the whole group; else use the dedicated
    // whole-group call (the rail-share denominator is filter-invariant).
    groupTotalEur: isAll ? active.groupTotalEur : whole.groupTotalEur,
    isLoading: active.isLoading || (!isAll && whole.isLoading),
  };
};

// --- EU funds (ИСУН) --------------------------------------------------------
// The transport group's EU-funds absorption per beneficiary — contracted vs paid,
// from the already-ingested fund_beneficiaries table (ONE /api/db/awarder-funds-rollup
// call over the EIK set). Not scope-windowed: EU-funds figures are programme-period
// lifetime totals (ОПТ / ОП „Транспортна свързаност"), not a parliament slice. Mirrors
// useVikFunds. The rail companies (НКЖИ, БДЖ) are major EU beneficiaries — this is the
// invest-half the procurement corpus can't show.

export interface TransportFundOp {
  eik: string;
  name: string;
  universe: TransportUniverse | "";
  contractedEur: number;
  paidEur: number;
  projectCount: number;
}

export const useTransportFunds = (
  eiks: readonly string[],
): { funds: TransportFundOp[]; isLoading: boolean } => {
  const eikParam = useMemo(() => [...eiks].join(","), [eiks]);
  const { data, isLoading } = useQuery({
    queryKey: ["db", "awarder-funds-rollup", "transport", eikParam] as const,
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

  const funds = useMemo<TransportFundOp[]>(
    () =>
      (data?.operators ?? []).map((o) => {
        const ent = transportEntityByEik(o.eik);
        return {
          eik: o.eik,
          name: ent?.name ?? `ЕИК ${o.eik}`,
          universe: ent?.universe ?? ("" as const),
          contractedEur: o.contractedEur,
          paidEur: o.paidEur,
          projectCount: o.projectCount,
        };
      }),
    [data],
  );

  return { funds, isLoading };
};
