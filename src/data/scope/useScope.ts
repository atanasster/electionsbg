// Shared time-window scope for every public-money view (procurement, water,
// defense, culture, judiciary, subsidies, the sectors hub …): "ns" (the selected
// parliament's window), "all" (the full corpus, every year) or "y:<year>" (one
// calendar year). Encoded in the URL as `?pscope=all` / `?pscope=y:2024` (ns is
// the default and stays out of the URL to keep it clean) so the scope is
// shareable AND survives navigation between a landing page and its sub-pages —
// see the URL contract note in CLAUDE.md. The `pscope` param name is kept for
// backwards-compatible links even though the hook is now scope-generic.
//
// Two consumers:
//   useScope()       — read the active scope + flip it (segmented control)
//   useScopedHref()  — build intra-section links that carry the current search
//                      params (pscope + elections) forward, so a non-default
//                      scope/election isn't dropped when a nav pill navigates
//                      with a bare pathname.

import { useCallback } from "react";
import { To, useSearchParams } from "react-router-dom";

export type Scope = "ns" | "all" | `y:${number}`;

const PARAM = "pscope";

// Re-exported from the UI-free constants module (shared with the Node loader).
export { SCOPE_FIRST_YEAR } from "./constants";

const parseScope = (raw: string | null): Scope => {
  if (raw === "all") return "all";
  if (raw && /^y:20\d{2}$/.test(raw)) return raw as Scope;
  return "ns";
};

/** The calendar year of a "y:<year>" scope, or null for ns/all. */
export const scopeYear = (scope: Scope): number | null =>
  scope.startsWith("y:") ? Number(scope.slice(2)) : null;

export const useScope = (): {
  scope: Scope;
  setScope: (next: Scope) => void;
} => {
  const [params, setParams] = useSearchParams();
  const scope = parseScope(params.get(PARAM));
  const setScope = useCallback(
    (next: Scope) => {
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
export const useScopedHref = (): ((pathname: string) => To) => {
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
