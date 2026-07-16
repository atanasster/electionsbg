// Data hook for the Митници (Customs) revenue pack. Revenue-first: it reads the
// already-ingested customs revenue-breakdown files (2022–2025) — no contract
// corpus (the buy-side ЗОП tiles already sit on the generic awarder page). The
// composition bar works for every year; the excise PRODUCT split is 2025-only
// (older files carry `excise_fuels` only), so the donut tile gates on it.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCustomsBreakdown } from "@/data/budget/useBudget";
import { CUSTOMS_YEARS } from "@/lib/customsReferenceData";
import type {
  ExciseOperator,
  ExciseRegisterFile,
  ExciseWarehouseMap,
} from "@/lib/customsReferenceData";
import { dataUrl } from "@/data/dataUrl";
import { fetchJsonSoft } from "@/data/fetchJson";
import type { CustomsBreakdownFile } from "@/data/budget/types";

export interface CustomsData {
  /** Newest-first, only the years whose file actually loaded. */
  years: number[];
  byYear: Record<number, CustomsBreakdownFile>;
  isLoading: boolean;
}

// Fixed hook count (one useCustomsBreakdown per known year) — React requires a
// stable hook order, so we can't map over a dynamic list.
export const useCustoms = (): CustomsData => {
  const y2025 = useCustomsBreakdown(2025);
  const y2024 = useCustomsBreakdown(2024);
  const y2023 = useCustomsBreakdown(2023);
  const y2022 = useCustomsBreakdown(2022);

  const queries = useMemo(
    () => [y2025, y2024, y2023, y2022],
    [y2025, y2024, y2023, y2022],
  );

  return useMemo(() => {
    const byYear: Record<number, CustomsBreakdownFile> = {};
    CUSTOMS_YEARS.forEach((yr, i) => {
      const data = queries[i]?.data;
      if (data) byYear[yr] = data;
    });
    return {
      years: CUSTOMS_YEARS.filter((yr) => byYear[yr]),
      byYear,
      isLoading: queries.some((q) => q.isLoading),
    };
  }, [queries]);
};

/** Amount (EUR) for one line id in a breakdown file, or 0. */
export const customsLineEur = (
  file: CustomsBreakdownFile | undefined,
  id: string,
): number => file?.lines.find((l) => l.id === id)?.amountEur ?? 0;

// --- Excise-warehouse register (лицензирани складодържатели) --------------
// Types live in the dependency-free @/lib/customsReferenceData (single source of
// truth, also imported by the AI tool); re-exported here for the hook's callers.
export type { ExciseOperator, ExciseRegisterFile };

export const useExciseRegister = () =>
  useQuery({
    queryKey: ["customs", "excise-register"] as const,
    queryFn: async (): Promise<ExciseRegisterFile | null> => {
      const r = await fetch(dataUrl("/customs/excise_register.json"));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      return (await r.json()) as ExciseRegisterFile;
    },
    staleTime: Infinity,
  });

// Geolocated active warehouses for the /customs/warehouses count map, from
// Postgres (excise_warehouses_map). Soft-miss → empty so a DB predating schema
// 072 (or a fresh clone) just hides the map instead of erroring.
export type { ExciseWarehouseMap };
export const useExciseWarehouseMap = () =>
  useQuery({
    queryKey: ["customs", "excise-warehouses"] as const,
    queryFn: async (): Promise<ExciseWarehouseMap> =>
      (await fetchJsonSoft<ExciseWarehouseMap>(
        "/api/db/excise-warehouses",
      )) ?? {
        warehouses: [],
      },
    staleTime: Infinity,
  });
