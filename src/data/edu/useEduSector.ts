// Data hooks for the /sector/edu sub-pages. The
// transport shape (src/data/transport/useTransportSector.ts), three requests and
// three bases, never mixed:
//
//   • useEduGroupModel — ONE /api/db/awarder-group-model call over a set of EIKs:
//     € by year and by supplier in the page's window. € is unaffected by
//     consortium members (they carry €0).
//   • useEduRollup — /api/db/awarder-group-rollup?exMembers=1: per-body contract
//     and single-bid COUNTS without the €0 consortium member rows — the basis the
//     hub's KPI 3 and national_competition (167) count on. The group model's
//     byUnit counts members and must not be put beside it.
//   • useEduFunds — /api/db/awarder-funds-rollup?basis=grant: ИСУН on the БФП
//     (grant) basis from fund_projects. Lifetime, never windowed.
//
// Every request THROWS on a failed response rather than returning an empty set:
// a failed fetch must not render as „no contracts" / „no EU funds".

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { useEikParam } from "@/data/procurement/useAwarderGroupModel";
import {
  buildAwarderModelFromAggregates,
  type AwarderModel,
  type GroupModelPayload,
  type SectorClassifier,
} from "@/lib/awarderModel";
import {
  educationEntityByEik,
  type EducationUniverse,
} from "@/lib/educationReferenceData";

/** Edu sub-pages read € by year and by supplier only — one category. Module
 *  level so the memo below is keyed on a stable reference. */
const ONE: SectorClassifier<"all"> = { categoryOf: () => "all" };
export type EduModel = AwarderModel<"all">;

export const useEduGroupModel = (
  eiks: readonly string[],
): {
  payload: GroupModelPayload | null;
  model: EduModel | null;
  isLoading: boolean;
  isError: boolean;
} => {
  const { from, to } = useScopeWindow();
  const eikParam = useEikParam(eiks);
  const { data, isLoading, isError } = useQuery({
    // Distinct from useAwarderGroupModel's key: that hook returns null on a
    // failed response, this one throws.
    queryKey: ["db", "awarder-group-model", "edu", eikParam, from, to] as const,
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
    () => (data ? buildAwarderModelFromAggregates(data, ONE) : null),
    [data],
  );
  return { payload: data ?? null, model, isLoading, isError };
};

/** One body's ex-member counts, with its name and universe resolved. */
export interface EduBodyAgg {
  eik: string;
  name: string;
  universe: EducationUniverse | "";
  totalEur: number;
  contractCount: number;
  bidKnownN: number;
  singleBidN: number;
}

export const useEduRollup = (
  eiks: readonly string[],
): {
  bodies: EduBodyAgg[];
  /** The SERVER confirmed it dropped consortium member rows; an older function
   *  ignores the param, and its counts must then not sit beside an ex-member
   *  national rate. */
  exMembers: boolean;
  isLoading: boolean;
  isError: boolean;
} => {
  const { from, to } = useScopeWindow();
  const eikParam = useEikParam(eiks);
  const { data, isLoading, isError } = useQuery({
    queryKey: [
      "db",
      "awarder-group-rollup",
      "edu",
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
  const bodies = useMemo<EduBodyAgg[]>(
    () =>
      (data?.operators ?? []).map((o) => {
        const ent = educationEntityByEik(o.eik);
        return {
          eik: o.eik,
          name: ent?.name ?? `ЕИК ${o.eik}`,
          universe: ent?.universe ?? ("" as const),
          totalEur: o.totalEur,
          contractCount: o.contractCount,
          bidKnownN: o.bidKnownN,
          singleBidN: o.singleBidN,
        };
      }),
    [data],
  );
  return { bodies, exMembers: data?.exMembers === true, isLoading, isError };
};

/** One ИСУН beneficiary on the grant basis. No total project value: a phased
 *  project carries its total once per phase, so summing it double-counts. */
export interface EduFundOp {
  eik: string;
  grantEur: number;
  paidEur: number;
  projectCount: number;
}

export const useEduFunds = (
  eiks: readonly string[],
): {
  funds: EduFundOp[];
  /** The server confirmed the grant basis; an older function answers on
   *  fund_beneficiaries' total-project-value basis instead. */
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
  const funds = useMemo<EduFundOp[]>(
    () =>
      grantBasis
        ? (data?.operators ?? []).map((o) => ({
            eik: o.eik,
            grantEur: o.grantEur ?? 0,
            paidEur: o.paidEur,
            projectCount: o.projectCount,
          }))
        : [],
    [data, grantBasis],
  );
  return { funds, grantBasis, isLoading, isError };
};
