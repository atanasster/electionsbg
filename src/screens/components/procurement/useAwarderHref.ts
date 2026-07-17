// The href half of AwarderLink, for the places that can't render a component —
// map-marker `href` payloads, `to:` fields in a config object, StatCard's `to`.
// Kept in its own module so AwarderLink.tsx only exports components (fast refresh).
//
// Same two invariants as AwarderLink: the link carries the active time scope
// (?pscope + elections — /awarder/:eik reads it, a bare pathname resets it), and the
// EIK is URL-encoded. See AwarderLink.tsx for the why.

import { To } from "react-router-dom";
import { useScopedHref } from "@/data/scope/useScope";

export const useAwarderHref = (): ((eik: string, sub?: string) => To) => {
  const scopedHref = useScopedHref();
  return (eik: string, sub?: string) =>
    scopedHref(`/awarder/${encodeURIComponent(eik)}${sub ? `/${sub}` : ""}`);
};
