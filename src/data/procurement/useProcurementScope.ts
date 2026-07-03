// Section-wide procurement scope: "ns" (the selected parliament's contract
// window), "all" (the full corpus, every year) or "y:<year>" (one calendar
// year). Encoded in the URL as `?pscope=all` / `?pscope=y:2024` (ns is the
// default and stays out of the URL to keep it clean) so the scope is shareable
// AND survives navigation between the procurement landing and its sub-pages —
// see the URL contract note in CLAUDE.md.
//
// Two consumers:
//   useProcurementScope()  — read the active scope + flip it (segmented control)
//   useProcurementHref()   — build intra-section links that carry the current
//                            search params (pscope + elections) forward, so a
//                            non-default scope/election isn't dropped when the
//                            nav pills navigate with a bare pathname.

import { useCallback } from "react";
import { To, useSearchParams } from "react-router-dom";

export type ProcurementScope = "ns" | "all" | `y:${number}`;

const PARAM = "pscope";

// The years the corpus actually covers — the earliest contract is 2011-01-03.
export const PROCUREMENT_FIRST_YEAR = 2011;

const parseScope = (raw: string | null): ProcurementScope => {
  if (raw === "all") return "all";
  if (raw && /^y:20\d{2}$/.test(raw)) return raw as ProcurementScope;
  return "ns";
};

/** The calendar year of a "y:<year>" scope, or null for ns/all. */
export const scopeYear = (scope: ProcurementScope): number | null =>
  scope.startsWith("y:") ? Number(scope.slice(2)) : null;

export const useProcurementScope = (): {
  scope: ProcurementScope;
  setScope: (next: ProcurementScope) => void;
} => {
  const [params, setParams] = useSearchParams();
  const scope = parseScope(params.get(PARAM));
  const setScope = useCallback(
    (next: ProcurementScope) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          // "ns" is the default → drop the param so the URL stays canonical.
          if (next === "ns") p.delete(PARAM);
          else p.set(PARAM, next);
          return p;
        },
        { replace: false },
      );
    },
    [setParams],
  );
  return { scope, setScope };
};

/** Returns a builder that turns a section pathname into a `To` carrying the
 *  current search string forward (so pscope + elections survive the click). */
export const useProcurementHref = (): ((pathname: string) => To) => {
  const [params] = useSearchParams();
  const search = params.toString();
  return useCallback(
    (pathname: string): To => ({
      pathname,
      search: search ? `?${search}` : "",
    }),
    [search],
  );
};
