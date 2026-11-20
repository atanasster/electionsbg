// Data hooks for /sector/health/procurement (docs/plans/health-hub-v1.md T3).
// The edu shape (src/data/edu/useEduSector.ts) with ONE difference that is the
// point of the page: every request carries exFramework=1 (D3).
//
// МЗ's central framework agreements are booked as joint_kind='framework' rows
// (087) — each an equal ceiling/N share of a framework's CEILING, not money
// spent. They are €1.31bn against €1.53bn of МЗ's real contracts, so summing them
// in nearly doubles the ministry. Each payload reports them on their own line
// (frameworkEur / frameworkCount) and echoes whether the server applied the
// switch: a database whose 061 predates it ignores the param, and its totals
// then INCLUDE the ceilings — the page must say so rather than trust its request.
//
//   • useHealthGroupModel — € by year / supplier in the page's window.
//   • useHealthRollup — per-body COUNTS and the single-bid pair without the €0
//     consortium member rows (the basis national_competition 167 counts on).
//   • useHealthTopContracts — the largest contracts in the window.
//
// Every request THROWS on a failed response: a failed fetch must not render as
// „no contracts".

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

const ONE: SectorClassifier<"all"> = { categoryOf: () => "all" };
export type HealthModel = AwarderModel<"all">;

const windowParams = (
  base: Record<string, string>,
  from: string | null | undefined,
  to: string | null | undefined,
): string => {
  const p = new URLSearchParams(base);
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  return p.toString();
};

const getJson = async <T>(route: string, qs: string): Promise<T> => {
  const r = await fetch(`/api/db/${route}?${qs}`);
  if (!r.ok) throw new Error(`${route} -> ${r.status}`);
  return r.json() as Promise<T>;
};

export const useHealthGroupModel = (
  eiks: readonly string[],
): {
  payload: GroupModelPayload | null;
  model: HealthModel | null;
  /** The server applied the framework exclusion (061's echo). */
  exFramework: boolean;
  isLoading: boolean;
  isError: boolean;
} => {
  const { from, to } = useScopeWindow();
  const eikParam = useEikParam(eiks);
  const { data, isLoading, isError } = useQuery({
    queryKey: [
      "db",
      "awarder-group-model",
      "health",
      eikParam,
      from,
      to,
    ] as const,
    queryFn: () =>
      getJson<GroupModelPayload>(
        "awarder-group-model",
        windowParams({ eiks: eikParam, exFramework: "1" }, from, to),
      ),
    enabled: eiks.length > 0,
    staleTime: Infinity,
  });
  const model = useMemo(
    () => (data ? buildAwarderModelFromAggregates(data, ONE) : null),
    [data],
  );
  return {
    payload: data ?? null,
    model,
    exFramework: data?.exFramework === true,
    isLoading,
    isError,
  };
};

/** One body's ex-member, ex-framework counts, with its framework line apart. */
export interface HealthBodyAgg {
  eik: string;
  totalEur: number;
  contractCount: number;
  bidKnownN: number;
  singleBidN: number;
  frameworkEur: number;
  frameworkN: number;
}

export const useHealthRollup = (
  eiks: readonly string[],
): {
  bodies: HealthBodyAgg[];
  /** Server echoes: consortium members dropped / framework rows dropped. An
   *  older function ignores either param, and its counts must then not sit
   *  beside an ex-member national rate. */
  exMembers: boolean;
  exFramework: boolean;
  isLoading: boolean;
  isError: boolean;
} => {
  const { from, to } = useScopeWindow();
  const eikParam = useEikParam(eiks);
  const { data, isLoading, isError } = useQuery({
    queryKey: [
      "db",
      "awarder-group-rollup",
      "health",
      eikParam,
      from,
      to,
    ] as const,
    queryFn: () =>
      getJson<{
        operators: HealthBodyAgg[];
        exMembers?: boolean;
        exFramework?: boolean;
      }>(
        "awarder-group-rollup",
        windowParams(
          { eiks: eikParam, exMembers: "1", exFramework: "1" },
          from,
          to,
        ),
      ),
    enabled: eiks.length > 0,
    staleTime: Infinity,
  });
  return {
    bodies: data?.operators ?? [],
    exMembers: data?.exMembers === true,
    exFramework: data?.exFramework === true,
    isLoading,
    isError,
  };
};

export interface HealthTopContract {
  key: string;
  date: string;
  contractorEik: string;
  contractorName: string;
  amountEur: number;
  title: string;
  awarderEik: string;
  numberOfTenderers: number | null;
}

export const useHealthTopContracts = (
  eiks: readonly string[],
  limit = 10,
): {
  contracts: HealthTopContract[];
  exFramework: boolean;
  isLoading: boolean;
  isError: boolean;
} => {
  const { from, to } = useScopeWindow();
  const eikParam = useEikParam(eiks);
  const { data, isLoading, isError } = useQuery({
    queryKey: [
      "db",
      "awarder-group-top-contracts",
      "health",
      eikParam,
      from,
      to,
      limit,
    ] as const,
    queryFn: () =>
      getJson<{ contracts: HealthTopContract[]; exFramework?: boolean }>(
        "awarder-group-top-contracts",
        windowParams(
          { eiks: eikParam, exFramework: "1", limit: String(limit) },
          from,
          to,
        ),
      ),
    enabled: eiks.length > 0,
    staleTime: Infinity,
  });
  return {
    contracts: data?.contracts ?? [],
    exFramework: data?.exFramework === true,
    isLoading,
    isError,
  };
};
