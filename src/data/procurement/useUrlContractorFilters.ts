// URL-backed filters for /procurement/contractors ("Топ изпълнители"). Kept separate
// from the shared useUrlProcurementFilters (which owns ?proc/?year/?grade the
// contractor leaderboard has no analogue for) because this browser's two dimensions
// are contractor-specific:
//   ?cpv — a single CPV selection from the shared CpvFilterCombobox, mapped to its
//          2-digit DIVISION for the server. The contractor_rank matview is a rollup
//          keyed by (scope_key × division) with an 'ALL' sentinel, so the division
//          filter is ALWAYS sent (default 'ALL') — a divisionless request would union
//          the rollup with every per-division row and double-count. (The engine now
//          also defaults it server-side via defaultFilters, but the screen sends it
//          explicitly so the reactive Σ€ KPI reflects the chosen division.)
//   ?mp  — a boolean "MP-tied only" toggle → is_mp_tied = true.
// ?q (free-text) is read at the screen and passed as DbDataTable's initialSearch.
//
// ⛔ ?sector IS DELIBERATELY ABSENT, and this is the one filter someone will try
// to add. Every other procurement browser reads it (getSectorBrowsePack →
// awarder_eik / buyer_eik IN …), so the omission looks like an oversight. It is
// not: `?sector` is a predicate on the BUYER, and `contractor_rank` (migration
// 122) has no buyer dimension at all — its columns are
// (scope_key, eik, division, name, name_fold, total_eur, contract_count,
// award_count, total_other, is_mp_tied). There is nothing to filter on.
//
// Adding one is not a column either: this resource is already a TWO-dimensional
// fan-out with rollup buckets, which is why `division` must always be sent (see
// above) and why the engine carries a defaultFilters guard against a ~2x
// double-counted leaderboard. A third dimension multiplies
// (scope_key × division × sector) and re-opens exactly that class, over a
// matview that already fans ~29.5k contractors × ~30 windows × division.
//
// The sector-scoped question — „who are culture's contractors" — is answered at
// /culture/procurement#contractors instead, rendered from awarder_group_model
// (migration 061), which already returns a COMPLETE per-contractor rollup for an
// arbitrary EIK set. Decided as T0/§1.3-B of docs/plans/culture-investigative-v1.md.
//
// extraFilters is memoised on the raw param values: DbDataTable diffs it BY IDENTITY
// to decide whether to reset pagination, so a fresh array each render would pin the
// table to page 1 forever (the useUrlProcurementFilters EMPTY_GRADES lesson).

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { DbColumnFilter } from "@/ux/data_table/DbDataTable";
import { CPV_ALL } from "@/screens/components/procurement/CpvFilterCombobox";

/** The rollup sentinel that means "every division" (matches the matview + registry). */
export const DIVISION_ALL = "ALL";

/** Map a CpvFilterCombobox value (division, finer code, or CPV_ALL) to the 2-digit
 *  division the contractor_rank rollup is keyed on. A finer code (e.g. 45230000)
 *  buckets to its division ('45'); anything that isn't a 2-digit-led code → 'ALL'.
 *  Exported for unit tests — this is the client half of the double-count guard. */
export const toDivision = (cpvSel: string): string => {
  if (cpvSel === CPV_ALL) return DIVISION_ALL;
  const head = cpvSel.slice(0, 2);
  return /^[0-9]{2}$/.test(head) ? head : DIVISION_ALL;
};

export interface UrlContractorFilters {
  /** Raw ?cpv value (CPV_ALL when absent) — drives the CpvFilterCombobox trigger. */
  cpvSel: string;
  /** The 2-digit division sent to the server ('ALL' when no CPV filter). */
  division: string;
  /** ?mp — MP-tied companies only. */
  mpTied: boolean;
  setCpvSel: (v: string) => void;
  setMpTied: (v: boolean) => void;
  /** The DbColumnFilter fragments for the table + facets — division ALWAYS present. */
  extraFilters: DbColumnFilter[];
  hasActiveFilters: boolean;
  clearFilters: () => void;
}

export const useUrlContractorFilters = (): UrlContractorFilters => {
  const [params, setParams] = useSearchParams();

  const setParam = useCallback(
    (key: string, val: string | null) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (val == null || val === "" || val === CPV_ALL) p.delete(key);
          else p.set(key, val);
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );

  const cpvSel = params.get("cpv") ?? CPV_ALL;
  const mpTied = params.get("mp") === "1";
  const division = toDivision(cpvSel);

  // Normalize to the 2-digit division ON WRITE, so ?cpv is never more precise than the
  // division-grained backend can honor: picking a fine catalogue code (45230000) stores
  // ?cpv=45, the trigger shows the division, and the URL doesn't preserve a precision the
  // results don't have. A value that resolves to 'ALL' clears the param.
  const setCpvSel = useCallback(
    (v: string) => {
      const d = toDivision(v);
      setParam("cpv", d === DIVISION_ALL ? null : d);
    },
    [setParam],
  );
  const setMpTied = useCallback(
    (v: boolean) => setParam("mp", v ? "1" : null),
    [setParam],
  );

  // Memoised on the derived scalars, not rebuilt each render (see header).
  const extraFilters = useMemo<DbColumnFilter[]>(() => {
    const f: DbColumnFilter[] = [{ id: "division", value: division }];
    if (mpTied) f.push({ id: "is_mp_tied", value: true });
    return f;
  }, [division, mpTied]);

  const hasActiveFilters = cpvSel !== CPV_ALL || mpTied;

  const clearFilters = useCallback(
    () =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          ["cpv", "mp"].forEach((k) => p.delete(k));
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );

  return {
    cpvSel,
    division,
    mpTied,
    setCpvSel,
    setMpTied,
    extraFilters,
    hasActiveFilters,
    clearFilters,
  };
};
