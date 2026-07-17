// The one way to link to an awarder page. Use this instead of hand-rolling
// `<Link to={`/awarder/${eik}`}>`.
//
// It exists because two invariants kept being forgotten at ~25 separate call sites,
// and both were real operator-reported bugs:
//
//  1. THE TIME SCOPE. /awarder/:eik reads ?pscope (useScope), but a bare pathname
//     drops it — so clicking an awarder from a ?pscope=all dashboard silently reset
//     to the default parliament window, and a unit with no awards in THAT window then
//     rendered an empty page. useScopedHref carries pscope + elections forward.
//  2. THE NAME. The corpus stores buyer names as each buyer typed them, so they
//     render sloppily ("Областна администрация - област варна"). When no children are
//     given, the curated canonical name is used (AWARDER_NAME_OVERRIDES).
//
// Pass children when you already have a display name to show (a rollup row, a table
// cell); omit them to get the canonical name for free. For non-component call sites
// (map markers, StatCard `to`), use useAwarderHref from ./useAwarderHref.

import { FC, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useScopedHref } from "@/data/scope/useScope";
import { canonicalAwarderName } from "@/lib/awarderNameOverrides";

export const AwarderLink: FC<{
  eik: string;
  /** Sub-page, e.g. "contractors" → /awarder/:eik/contractors. */
  sub?: string;
  /** Display text. Omit to fall back to the curated canonical name, then the EIK. */
  children?: ReactNode;
  className?: string;
  title?: string;
  onClick?: () => void;
}> = ({ eik, sub, children, className, title, onClick }) => {
  const scopedHref = useScopedHref();
  const pathname = `/awarder/${encodeURIComponent(eik)}${sub ? `/${sub}` : ""}`;
  return (
    <Link
      to={scopedHref(pathname)}
      className={className}
      title={title}
      onClick={onClick}
    >
      {children ?? canonicalAwarderName(eik) ?? eik}
    </Link>
  );
};
