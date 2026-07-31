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
//                      params forward, so a non-default scope/election isn't
//                      dropped when a nav pill navigates with a bare pathname.
//
//                      ⚠ It forwards the WHOLE query string, not just pscope +
//                      elections. That is invisible on a nav pill (those pages
//                      carry little else), but a link rendered inside a FILTERED
//                      browser hands its filters to the destination: an AwarderLink
//                      in a /procurement/contracts row carries ?grade / ?single /
//                      ?proc / ?cpv / ?q onto /awarder/:eik, where
//                      useUrlProcurementFilters reads them and pre-filters the page.
//
//                      KEPT DELIBERATELY (decided 2026-07-30, when the contracts
//                      browser became the first caller with a filter set rich enough
//                      to notice): carrying the filters through a drill-down is the
//                      wanted behaviour. Do not "fix" it to an allowlist — the name
//                      undersells it, this comment is the correction.

import { useCallback } from "react";
import { To, useSearchParams } from "react-router-dom";
// Re-exported from the UI-free constants module (shared with the Node loader).
// Imported rather than re-exported straight through because defaultScopeYears
// below needs the local binding (`export … from` creates none).
import { SCOPE_FIRST_YEAR } from "./constants";

export { SCOPE_FIRST_YEAR };

export type Scope = "ns" | "all" | `y:${number}`;

const PARAM = "pscope";

const parseScope = (raw: string | null): Scope => {
  if (raw === "all") return "all";
  if (raw && /^y:20\d{2}$/.test(raw)) return raw as Scope;
  return "ns";
};

/** The calendar year of a "y:<year>" scope, or null for ns/all. */
export const scopeYear = (scope: Scope): number | null =>
  scope.startsWith("y:") ? Number(scope.slice(2)) : null;

/** What a page can actually serve. Omit a field to accept the shared default:
 *  every calendar year the corpus covers, plus the full-corpus scope. */
export type ScopeSupport = {
  /** The calendar years this page has data for. */
  years?: number[];
  /** Whether "all" (the full corpus) is a scope this page can render. */
  allowAll?: boolean;
};

/** Every year the shared picker offers by default, newest first — the corpus
 *  floor through the current year, exactly the set the per-scope precomputes
 *  cover (see allScopeWindows in ./windows). */
export const defaultScopeYears = (
  nowYear: number = new Date().getFullYear(),
): number[] =>
  Array.from({ length: nowYear - SCOPE_FIRST_YEAR + 1 }, (_, i) => nowYear - i);

const DEFAULT_YEARS = defaultScopeYears();

/** Clamp a scope to what the page can actually render, falling back to "ns".
 *
 *  WHY. `?pscope` is shared across every public-money section and now rides
 *  along on ordinary in-app links (it is in the usePreserveParams allowlist), so
 *  a scope minted where it IS valid — `y:2019` on /procurement — arrives on a
 *  page whose picker has no such option: the НФЦ film register on /culture ends
 *  a year or two back, /administration's Доклад lags further, the CAP corpus
 *  behind /subsidies skips 2014/2018/2019/2020 outright.
 *
 *  Left unresolved that state is not merely useless, it is DISHONEST: a Radix
 *  Select whose controlled value matches no item renders EMPTY — not even the
 *  placeholder — so the whole widget read as the page default ("Всички години"
 *  on /culture) while the page underneath answered for some other window. A page
 *  that resolves here and hands the SAME value to its <ScopeControl> cannot get
 *  into that state, because the pill and the numbers are one value.
 *
 *  Falling back is not the only honest answer: a page that would rather NAME the
 *  gap ("no subsidy data for 2019", /subsidies) keeps the raw scope and says so.
 *  What no page may do is show one window and count another. */
export const resolveScope = (scope: Scope, support?: ScopeSupport): Scope => {
  if (scope === "all") return support?.allowAll === false ? "ns" : "all";
  const year = scopeYear(scope);
  if (year == null) return "ns";
  return (support?.years ?? DEFAULT_YEARS).includes(year) ? scope : "ns";
};

/** The active scope, already resolved against what the caller can serve.
 *  A page with narrower coverage than the corpus passes its own support and MUST
 *  pass the same to its <ScopeControl>, so the picker and the aggregation can
 *  never disagree about which window is on screen. */
export const useScope = (
  support?: ScopeSupport,
): {
  scope: Scope;
  setScope: (next: Scope) => void;
} => {
  const [params, setParams] = useSearchParams();
  const scope = resolveScope(parseScope(params.get(PARAM)), support);
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
