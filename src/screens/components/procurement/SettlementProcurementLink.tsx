// The one way to link to a settlement's procurement page. Use this instead of
// hand-rolling `<Link to={`/procurement/settlement/${ekatte}`}>`.
//
// The sibling of AwarderLink, and it exists for the same reason — with the difference
// that here the bug was introduced by making the DESTINATION scope-aware rather than by
// forgetting the source. `/procurement/settlement/:ekatte` now reads ?pscope (it is a
// contracts browser over the buyers seated in one place), so every bare pathname pointing
// at it silently reset the reader's window to the default parliament, and the page
// answered for a different period under the same heading.
//
// The five entry points, all converted: the watchlist, the My-Area tile, the settlement
// tile (twice), the place seat line, and the by-settlement ranking.
//
// NAMED for its destination, not its subject: `SettlementLink` already exists in
// components/settlements/ and goes to /sections/:ekatte (the elections view). Two
// same-named components pointing at different pages is a mistake an import completion
// makes for you.
//
// useScopedHref carries the whole current query string forward, so the scope (and the
// selected election) survive the drill-down. For non-component call sites use
// useSettlementProcurementHref from ./useSettlementProcurementHref.

import { FC, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useSettlementProcurementHref } from "./useSettlementProcurementHref";

export const SettlementProcurementLink: FC<{
  ekatte: string;
  children: ReactNode;
  className?: string;
  title?: string;
}> = ({ ekatte, children, className, title }) => {
  const settlementHref = useSettlementProcurementHref();
  return (
    <Link to={settlementHref(ekatte)} className={className} title={title}>
      {children}
    </Link>
  );
};
