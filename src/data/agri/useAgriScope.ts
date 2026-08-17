// The `?pscope` scope gate every /subsidies page shares.
//
// Four states, not two, and the distinction is what stops a page lying:
//
//   failed   — the fetch errored, or React Query PAUSED it (offline, or a hidden tab
//              whose fetch failed). Paused has no data, no error and isLoading false,
//              so „empty and not isError" reads as equivalent to „no data" and is not:
//              that inversion once told a reader 2016 was unpublished while listing
//              2016 among the published years.
//   noData   — absence is KNOWN: the scope is outside the corpus (agriScopeToKey
//              returned null, so no query ran) or the fetch came back carrying
//              nothing. Only here may the page say „няма данни".
//   loading  — anything else empty is a load that has not completed. Say so.
//   ready    — the payload is in hand.
//
// THE SCOPE IS READ UNRESOLVED, deliberately — the second of the two contracts
// ScopeControl's header describes. /subsidies answers a year it cannot serve with an
// explicit „няма данни за 2019" and keeps that year in the pill, rather than silently
// re-anchoring. The hook and the <ScopeControl> pass the same (absent) support
// argument, so the pill and the numbers are one value; `years` only governs which
// items the picker OFFERS, and an off-list year still shows via its own activeLabel.

import { useAgriOverview } from "./useAgriOverview";
import { agriScopeToKey } from "./constants";
import { useScope, type Scope } from "@/data/scope/useScope";
import type { AgriIndexFile } from "./types";

export interface AgriScopeState {
  scope: Scope;
  setScope: (next: Scope) => void;
  data: AgriIndexFile | null | undefined;
  state: "failed" | "noData" | "loading" | "ready";
  paused: boolean;
  refetch: () => void;
}

export const useAgriScope = (): AgriScopeState => {
  const { scope, setScope } = useScope();
  const payloadKey = agriScopeToKey(scope);
  const { data, isError, isSuccess, fetchStatus, refetch } =
    useAgriOverview(payloadKey);

  const noData = payloadKey === null || (isSuccess && !data);
  const paused = fetchStatus === "paused";
  const state: AgriScopeState["state"] = data
    ? "ready"
    : noData
      ? "noData"
      : isError || paused
        ? "failed"
        : "loading";

  return {
    scope,
    setScope,
    data,
    state,
    paused,
    refetch: () => void refetch(),
  };
};

/**
 * An in-module link that CARRIES THE SCOPE.
 *
 * `?pscope` is in usePreserveParams' allowlist, so `@/ux/Link` and `InfographicTile`
 * forward it for free — but a plain react-router `<Link to="/subsidies/places">` does
 * NOT, and that is how the hub's „Виж картата" tile came to show 2016 and land the
 * reader on 2025. `elections` rides along for the same reason the hub's own browseTo
 * carries it: it is a reader's global choice, not one page's state.
 */
export const agriScopedHref = (
  pathname: string,
  params: URLSearchParams,
  extra: Record<string, string> = {},
): string => {
  const p = new URLSearchParams();
  for (const k of ["pscope", "elections"]) {
    const v = params.get(k);
    if (v) p.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `${pathname}?${s}` : pathname;
};
