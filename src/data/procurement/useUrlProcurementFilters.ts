// Shared URL-backed filter plumbing for the three procurement browsers —
// /procurement/contracts (ContractsBrowserDbScreen), /procurement/tenders
// (TendersBrowserDbScreen) and /company|/awarder/:eik/contracts
// (CompanyContractsDbScreen). Each keeps its filters in the query string so a
// filtered view is shareable (the app's URL-contract convention); this hook owns
// the read/write of the common dimensions:
//   ?proc      — the bucketed procedure selection (validated via isProcedureBucket)
//   ?cpv       — the CPV division / prefix / comma-set (FILTER_ALL sentinel = none)
//   ?single|?cancelled — a boolean toggle (param name differs per browser)
//   ?year      — company/awarder only (the global browsers scope by ?pscope instead)
// The screens still build their own DbColumnFilter fragments from these values
// (the CPV column differs — prefix vs multi-division "in", plus year→date range);
// this hook only manages the params. Extracted per FINDING-001/DUP-001 (T3 review).

import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { isProcedureBucket, type ProcedureBucket } from "@/lib/cpvSectors";
import { CPV_ALL } from "@/screens/components/procurement/CpvFilterCombobox";

// ?year and ?cpv share the CPV combobox's "no selection" sentinel, so a value
// equal to it means "no filter" and clears the param on write.
export const FILTER_ALL = CPV_ALL;

export interface UseUrlProcurementFiltersOptions {
  /** URL param name for the boolean toggle: "single" (single-bidder, on the
   *  contracts + company browsers) or "cancelled" (on the tenders browser). */
  toggleParam: "single" | "cancelled";
  /** Include the ?year dimension — only the company/awarder contracts page has a
   *  per-year picker; the global browsers bound time via ?pscope instead. */
  withYear?: boolean;
}

export interface UrlProcurementFilters {
  /** Bucketed procedure selection from ?proc — null when absent or invalid. */
  procBucket: ProcedureBucket | null;
  /** ?cpv value (a 2-digit division, comma-joined set, or code prefix);
   *  FILTER_ALL when absent. */
  cpvSel: string;
  /** The boolean toggle (?single / ?cancelled). */
  toggle: boolean;
  /** ?year value (FILTER_ALL when absent); always FILTER_ALL when withYear=false. */
  year: string;
  setProcBucket: (v: ProcedureBucket | null) => void;
  setCpvSel: (v: string) => void;
  setToggle: (v: boolean) => void;
  /** Write ?year; a no-op when withYear is false (the param is unmanaged there). */
  setYear: (v: string) => void;
  /** True when any managed filter is active (drives the "clear" button). */
  hasActiveFilters: boolean;
  /** Clear every managed param, preserving all others (?pscope/?topic/?sector/?q/…). */
  clearFilters: () => void;
}

export const useUrlProcurementFilters = ({
  toggleParam,
  withYear = false,
}: UseUrlProcurementFiltersOptions): UrlProcurementFilters => {
  const [params, setParams] = useSearchParams();

  // Set/clear one param, preserving the others (?pscope / ?sector / ?topic / ?q /
  // ?elections …). Empty / sentinel values delete the param so the default view
  // keeps a clean URL. {replace:true} keeps filter toggling out of history.
  const setParam = useCallback(
    (key: string, val: string | null) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (val == null || val === "" || val === FILTER_ALL) p.delete(key);
          else p.set(key, val);
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );

  // ?proc is untrusted URL input, so validate it against the known bucket set.
  const rawProc = params.get("proc");
  const procBucket: ProcedureBucket | null = isProcedureBucket(rawProc)
    ? rawProc
    : null;
  const cpvSel = params.get("cpv") ?? FILTER_ALL;
  const toggle = params.get(toggleParam) === "1";
  const year = withYear ? (params.get("year") ?? FILTER_ALL) : FILTER_ALL;

  const setProcBucket = useCallback(
    (v: ProcedureBucket | null) => setParam("proc", v),
    [setParam],
  );
  const setCpvSel = useCallback((v: string) => setParam("cpv", v), [setParam]);
  const setToggle = useCallback(
    (v: boolean) => setParam(toggleParam, v ? "1" : null),
    [setParam, toggleParam],
  );
  // A no-op unless withYear is set — the global browsers ignore ?year on read and
  // omit it from clearFilters, so writing it there would strand an orphan param.
  const setYear = useCallback(
    (v: string) => {
      if (withYear) setParam("year", v);
    },
    [setParam, withYear],
  );

  const hasActiveFilters =
    procBucket !== null ||
    cpvSel !== FILTER_ALL ||
    toggle ||
    (withYear && year !== FILTER_ALL);

  const clearFilters = useCallback(
    () =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          const keys = withYear
            ? ["year", "proc", "cpv", toggleParam]
            : ["proc", "cpv", toggleParam];
          keys.forEach((k) => p.delete(k));
          return p;
        },
        { replace: true },
      ),
    [setParams, toggleParam, withYear],
  );

  return {
    procBucket,
    cpvSel,
    toggle,
    year,
    setProcBucket,
    setCpvSel,
    setToggle,
    setYear,
    hasActiveFilters,
    clearFilters,
  };
};
