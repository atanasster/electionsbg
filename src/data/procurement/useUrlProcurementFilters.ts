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
//   ?grade     — contracts browsers only; validated A–F set for the risk column
// The screens still build their own DbColumnFilter fragments from these values
// (the CPV column differs — prefix vs multi-division "in", plus year→date range);
// this hook only manages the params. Extracted per FINDING-001/DUP-001 (T3 review).

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { isProcedureBucket, type ProcedureBucket } from "@/lib/cpvSectors";
import { GRADE_TONE, type RiskGradeLetter } from "@/lib/riskGrade";
import { CPV_ALL } from "@/screens/components/procurement/CpvFilterCombobox";

// ?year and ?cpv share the CPV combobox's "no selection" sentinel, so a value
// equal to it means "no filter" and clears the param on write.
export const FILTER_ALL = CPV_ALL;

// GRADE_TONE is a Record over the full RiskGradeLetter union, so this set fails
// to COMPILE if a letter is ever added without being listed — which keeps the
// validator from silently going stale the way a hand-written list would.
// A Set, not `v in GRADE_TONE`: `in` walks the prototype chain, so "toString"
// and "constructor" would both pass. Only `.toUpperCase()` was hiding that.
const GRADE_SET = new Set<string>(Object.keys(GRADE_TONE));
const isRiskGrade = (v: string): v is RiskGradeLetter => GRADE_SET.has(v);

// Stable identity for the empty case. `grades` feeds a DbColumnFilter array that
// DbDataTable compares BY IDENTITY to decide whether to reset pagination, so a
// fresh [] every render silently pins the table to page 1.
const EMPTY_GRADES: RiskGradeLetter[] = [];

export interface UseUrlProcurementFiltersOptions {
  /** URL param name for the boolean toggle: "single" (single-bidder, on the
   *  contracts + company browsers) or "cancelled" (on the tenders browser). */
  toggleParam: "single" | "cancelled";
  /** Include the ?year dimension — only the company/awarder contracts page has a
   *  per-year picker; the global browsers bound time via ?pscope instead. */
  withYear?: boolean;
  /** Include the ?grade dimension — the contracts browsers only. The tenders
   *  browser has no per-tender risk index yet (112 covers contracts), so a grade
   *  filter there would render a control that can never match a row. */
  withRisk?: boolean;
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
  /** Validated A–F set from ?grade (comma-joined, the ?cpv convention). Empty
   *  when absent, when withRisk=false, or when every letter was junk. */
  grades: RiskGradeLetter[];
  setProcBucket: (v: ProcedureBucket | null) => void;
  setCpvSel: (v: string) => void;
  setToggle: (v: boolean) => void;
  /** Write ?year; a no-op when withYear is false (the param is unmanaged there). */
  setYear: (v: string) => void;
  /** Write ?grade; a no-op when withRisk is false (same reason as setYear). */
  setGrades: (v: RiskGradeLetter[]) => void;
  /** True when any managed filter is active (drives the "clear" button). */
  hasActiveFilters: boolean;
  /** Clear every managed param, preserving all others (?pscope/?topic/?sector/?q/…). */
  clearFilters: () => void;
}

export const useUrlProcurementFilters = ({
  toggleParam,
  withYear = false,
  withRisk = false,
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
  // ?grade is untrusted and flows into a DbColumnFilter `in` list, so every
  // letter is validated and junk is dropped rather than passed through. Deduped
  // and sorted so ?grade=F,D,F and ?grade=D,F produce one canonical filter.
  // Memoised on the RAW param string, not on the derived array: the screens
  // spread this into `extraFilters`, which DbDataTable diffs by identity to
  // decide whether to reset pagination — recomputing it each render pins the
  // table to page 1 forever.
  const rawGrade = withRisk ? params.get("grade") : null;
  const grades: RiskGradeLetter[] = useMemo(() => {
    if (!rawGrade) return EMPTY_GRADES;
    const parsed = [
      ...new Set(
        rawGrade
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(isRiskGrade),
      ),
    ].sort();
    return parsed.length ? parsed : EMPTY_GRADES;
  }, [rawGrade]);

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

  const setGrades = useCallback(
    (v: RiskGradeLetter[]) => {
      if (withRisk)
        setParam("grade", v.length ? [...v].sort().join(",") : null);
    },
    [setParam, withRisk],
  );

  const hasActiveFilters =
    procBucket !== null ||
    cpvSel !== FILTER_ALL ||
    toggle ||
    (withYear && year !== FILTER_ALL) ||
    grades.length > 0;

  const clearFilters = useCallback(
    () =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          const keys = ["proc", "cpv", toggleParam];
          if (withYear) keys.push("year");
          if (withRisk) keys.push("grade");
          keys.forEach((k) => p.delete(k));
          return p;
        },
        { replace: true },
      ),
    [setParams, toggleParam, withYear, withRisk],
  );

  return {
    procBucket,
    cpvSel,
    toggle,
    year,
    grades,
    setProcBucket,
    setCpvSel,
    setToggle,
    setYear,
    setGrades,
    hasActiveFilters,
    clearFilters,
  };
};
