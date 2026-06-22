// Section-wide procurement scope: "ns" (the selected parliament's contract
// window) vs "all" (the full corpus, every year). Encoded in the URL as
// `?pscope=all` (ns is the default and stays out of the URL to keep it clean)
// so the scope is shareable AND survives navigation between the procurement
// landing and its sub-pages — see the URL contract note in CLAUDE.md.
//
// Two consumers:
//   useProcurementScope()  — read the active scope + flip it (segmented control)
//   useProcurementHref()   — build intra-section links that carry the current
//                            search params (pscope + elections) forward, so a
//                            non-default scope/election isn't dropped when the
//                            nav pills navigate with a bare pathname.

import { useCallback } from "react";
import { To, useSearchParams } from "react-router-dom";

export type ProcurementScope = "ns" | "all";

const PARAM = "pscope";

export const useProcurementScope = (): {
  scope: ProcurementScope;
  setScope: (next: ProcurementScope) => void;
} => {
  const [params, setParams] = useSearchParams();
  const scope: ProcurementScope = params.get(PARAM) === "all" ? "all" : "ns";
  const setScope = useCallback(
    (next: ProcurementScope) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          // "ns" is the default → drop the param so the URL stays canonical.
          if (next === "all") p.set(PARAM, "all");
          else p.delete(PARAM);
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
