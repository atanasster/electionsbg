// Data hooks for the /sector/transport sub-pages (docs/plans/transport-hub-v1.md
// T3). They replace useTransport.tsx, which served the deleted TransportPack.
//
// Four requests, each answering a different question and each on its stated
// basis — never mixed:
//
//   • useTransportGroupModel — ONE /api/db/awarder-group-model call over a set of
//     EIKs: € by function, supplier, method and year, plus the raw payload the
//     re-attribution needs (byUnit, byCpv). € is unaffected by consortium
//     members (they carry €0).
//   • useTransportRollup — /api/db/awarder-group-rollup?exMembers=1: per-body
//     contract and single-bid COUNTS without the €0 consortium member rows, the
//     basis the hub's KPI 3 and the browse pack count on (A2 / C1). The
//     group-model's byUnit counts members and must not be put beside it.
//   • useTransportFunds — /api/db/awarder-funds-rollup?basis=grant: ИСУН on the
//     БФП (grant) basis from fund_projects, with the total project value as a
//     secondary figure (D6). Lifetime, never windowed.
//
// Every request THROWS on a failed response rather than returning an empty set:
// a failed fetch must not render as „no contracts" / „no EU funds".

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { useEikParam } from "@/data/procurement/useAwarderGroupModel";
import type { GroupModelPayload } from "@/lib/awarderModel";
import {
  buildTransportModelFromAggregates,
  type TransportModel,
} from "@/lib/transportAttributes";
import {
  TRANSPORT_EIK,
  transportEntityByEik,
  type TransportUniverse,
} from "@/lib/transportReferenceData";

const useWindow = () => {
  const { from, to } = useScopeWindow();
  return { from, to };
};

/** The raw group-model payload and the transport model folded from it. */
export const useTransportGroupModel = (
  eiks: readonly string[],
): {
  payload: GroupModelPayload | null;
  model: TransportModel | null;
  isLoading: boolean;
  isError: boolean;
} => {
  const { from, to } = useWindow();
  const eikParam = useEikParam(eiks);
  const { data, isLoading, isError } = useQuery({
    // A distinct key from useAwarderGroupModel's: that hook returns null on a
    // failed response, this one throws — two queryFns under one key would
    // disagree about what a failure looks like.
    queryKey: [
      "db",
      "awarder-group-model",
      "transport",
      eikParam,
      from,
      to,
    ] as const,
    queryFn: async (): Promise<GroupModelPayload> => {
      const p = new URLSearchParams({ eiks: eikParam });
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      const r = await fetch(`/api/db/awarder-group-model?${p.toString()}`);
      if (!r.ok) throw new Error(`awarder-group-model -> ${r.status}`);
      return r.json();
    },
    enabled: eiks.length > 0,
    staleTime: Infinity,
  });
  const model = useMemo(
    () => (data ? buildTransportModelFromAggregates(data) : null),
    [data],
  );
  return { payload: data ?? null, model, isLoading, isError };
};

/** The ministry's own per-CPV € — the input to the D8 re-attribution (its PSO
 *  and rolling-stock contracts are rail). Same window as the page. */
const MINISTRY = [TRANSPORT_EIK];
export const useMinistryByCpv = () => {
  const { payload, isLoading, isError } = useTransportGroupModel(MINISTRY);
  return { byCpv: payload?.byCpv ?? null, isLoading, isError };
};

/** One body's ex-member counts, with its name and universe resolved. */
export interface TransportBodyAgg {
  eik: string;
  name: string;
  universe: TransportUniverse | "";
  totalEur: number;
  contractCount: number;
  bidKnownN: number;
  singleBidN: number;
  /** Single-bid share among bid-known contracts; null when none carries a count. */
  singleBidShare: number | null;
}

export const useTransportRollup = (
  eiks: readonly string[],
): {
  bodies: TransportBodyAgg[];
  /** The SERVER confirmed it dropped consortium member rows; a function deployed
   *  before the switch ignores the param, and its counts must then not be set
   *  beside an ex-member national rate. */
  exMembers: boolean;
  isLoading: boolean;
  isError: boolean;
} => {
  const { from, to } = useWindow();
  const eikParam = useEikParam(eiks);
  const { data, isLoading, isError } = useQuery({
    queryKey: [
      "db",
      "awarder-group-rollup",
      "transport",
      eikParam,
      from,
      to,
      "ex",
    ] as const,
    queryFn: async (): Promise<{
      operators: {
        eik: string;
        contractCount: number;
        totalEur: number;
        bidKnownN: number;
        singleBidN: number;
      }[];
      exMembers?: boolean;
    }> => {
      const p = new URLSearchParams({ eiks: eikParam, exMembers: "1" });
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      const r = await fetch(`/api/db/awarder-group-rollup?${p.toString()}`);
      if (!r.ok) throw new Error(`awarder-group-rollup -> ${r.status}`);
      return r.json();
    },
    enabled: eiks.length > 0,
    staleTime: Infinity,
  });
  const bodies = useMemo<TransportBodyAgg[]>(
    () =>
      (data?.operators ?? []).map((o) => {
        const ent = transportEntityByEik(o.eik);
        return {
          eik: o.eik,
          name: ent?.name ?? `ЕИК ${o.eik}`,
          universe: ent?.universe ?? ("" as const),
          totalEur: o.totalEur,
          contractCount: o.contractCount,
          bidKnownN: o.bidKnownN,
          singleBidN: o.singleBidN,
          singleBidShare: o.bidKnownN > 0 ? o.singleBidN / o.bidKnownN : null,
        };
      }),
    [data],
  );
  return {
    bodies,
    exMembers: data?.exMembers === true,
    isLoading,
    isError,
  };
};

/** One ИСУН beneficiary on the grant basis (D6). */
export interface TransportFundOp {
  eik: string;
  name: string;
  universe: TransportUniverse | "";
  /** БФП — the grant awarded. The contracted figure on this basis. */
  grantEur: number;
  /** Total project value, own contribution included — secondary. */
  totalEur: number;
  paidEur: number;
  projectCount: number;
}

export const useTransportFunds = (
  eiks: readonly string[],
): {
  funds: TransportFundOp[];
  /** The server confirmed the grant basis; an older function ignores the param
   *  and answers on fund_beneficiaries' total-project-value basis instead. */
  grantBasis: boolean;
  isLoading: boolean;
  isError: boolean;
} => {
  const eikParam = useEikParam(eiks);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["db", "awarder-funds-rollup", "grant", eikParam] as const,
    queryFn: async (): Promise<{
      basis?: string;
      operators: {
        eik: string;
        grantEur?: number;
        totalEur?: number;
        paidEur: number;
        projectCount: number;
      }[];
    }> => {
      const r = await fetch(
        `/api/db/awarder-funds-rollup?basis=grant&eiks=${encodeURIComponent(eikParam)}`,
      );
      if (!r.ok) throw new Error(`awarder-funds-rollup -> ${r.status}`);
      return r.json();
    },
    enabled: eiks.length > 0,
    staleTime: Infinity,
  });
  const grantBasis = data?.basis === "grant";
  const funds = useMemo<TransportFundOp[]>(
    () =>
      grantBasis
        ? (data?.operators ?? []).map((o) => {
            const ent = transportEntityByEik(o.eik);
            return {
              eik: o.eik,
              name: ent?.name ?? `ЕИК ${o.eik}`,
              universe: ent?.universe ?? ("" as const),
              grantEur: o.grantEur ?? 0,
              totalEur: o.totalEur ?? 0,
              paidEur: o.paidEur,
              projectCount: o.projectCount,
            };
          })
        : [],
    [data, grantBasis],
  );
  return { funds, grantBasis, isLoading, isError };
};
