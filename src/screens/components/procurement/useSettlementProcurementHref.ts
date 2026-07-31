// The href half of SettlementProcurementLink, for the places that can't render a component —
// a `to:` field in a config object, an href built inside a mapping function.
// Kept in its own module so SettlementProcurementLink.tsx only exports components (fast refresh).
//
// Same invariant as SettlementProcurementLink: the link carries the active time scope
// (/procurement/settlement/:ekatte reads ?pscope, and a bare pathname resets it).
// See SettlementProcurementLink.tsx for the why.

import { To } from "react-router-dom";
import { useScopedHref } from "@/data/scope/useScope";

export const useSettlementProcurementHref = (): ((ekatte: string) => To) => {
  const scopedHref = useScopedHref();
  return (ekatte: string) =>
    scopedHref(`/procurement/settlement/${encodeURIComponent(ekatte)}`);
};
