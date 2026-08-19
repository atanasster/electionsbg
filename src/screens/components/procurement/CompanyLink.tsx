// The one way to link to a company page from a CONTRACTOR key. Use this instead of
// hand-rolling `<Link to={`/company/${eik}`}>`.
//
// It exists for the same reason AwarderLink does — one invariant kept being
// forgotten at many call sites — but the invariant here is simpler and the failure
// louder: **not every supplier key HAS a company page.** `contracts.contractor_eik`
// carries 1,803 synthetic carriers (`obed-` / `ph-` / `np-`) and 281 foreign
// registry ids, and `institution_identity()` returns NULL for all 2,084, so the
// page renders „Няма фирма с ЕИК … в базата.". Every one was a live link before.
//
// When the key is not servable this renders the name as plain text. It deliberately
// does NOT hide the row: the supplier is real and its money is real — Elsevier B.V.
// is a `ph-` key holding €32.8M — so it belongs on the leaderboard. What it must
// not do is promise a page that does not exist.
//
// ⚠ CONTRACTOR KEYS ONLY. `isLinkableCompanyKey` accepts the 9- and 13-digit forms
// `canonicalEik` emits, which is exactly the contractor domain — but AWARDER keys
// are validated by `isValidEik`, which admits 9–13 digits, and two live awarders
// sit outside 9/13: ЕСО `1752013040` (10 digits, 10 rows) and АДФИ `175076479999`
// (12 digits). Both RESOLVE. Routing an awarder through this component de-links
// them, which is why the awarder row on /contract/:key deliberately does not use it.
//
// ⚠ THE NON-LINK BRANCH STRIPS LINK AFFORDANCE. Call sites pass `hover:underline`
// (and sometimes `text-primary`) together with layout classes like `truncate` and
// `min-w-0`. Rendering the span with that className verbatim gives a dead key
// something that looks and hovers like a link and does nothing — a worse affordance
// than the dead link it replaced. Layout classes are kept; only the affordance
// tokens are dropped.
//
// See src/lib/companyKey.ts for why a plain EIK stays linkable with no registry row.

import { FC, ReactNode } from "react";
import { Link } from "react-router-dom";
import { isLinkableCompanyKey } from "@/lib/companyKey";
import { useScopedHref } from "@/data/scope/useScope";

/** Classes that promise interactivity. Dropped WHOLE-TOKEN on the plain-text
 *  branch — never by substring. A `\b`-anchored regex mangles every composite
 *  Tailwind token that merely contains one of these: `underline-offset-2` →
 *  `-offset-2`, `hover:text-primary` → `hover:`, `text-primary/70` → `/70`.
 *  Splitting on whitespace and comparing exactly cannot do that. */
const AFFORDANCE = new Set([
  "underline",
  "hover:underline",
  "text-primary",
  "hover:text-primary",
  "cursor-pointer",
]);

const withoutAffordance = (className?: string): string | undefined =>
  className
    ?.split(/\s+/)
    .filter((c) => c && !AFFORDANCE.has(c))
    .join(" ") || undefined;

export const CompanyLink: FC<{
  eik: string | undefined;
  /** Display text. Falls back to the key itself, matching the old call sites. */
  children?: ReactNode;
  className?: string;
  title?: string;
}> = ({ eik, children, className, title }) => {
  // Carry the time scope, exactly as AwarderLink does: /company/:eik reads
  // useScope(), so a bare pathname silently resets a ?pscope=all view to the
  // default parliament window.
  const scopedHref = useScopedHref();
  const label = children ?? eik ?? "";

  if (!isLinkableCompanyKey(eik))
    return (
      <span className={withoutAffordance(className)} title={title}>
        {label}
      </span>
    );

  return (
    <Link
      to={scopedHref(`/company/${encodeURIComponent(eik!)}`)}
      className={className}
      title={title}
    >
      {label}
    </Link>
  );
};
