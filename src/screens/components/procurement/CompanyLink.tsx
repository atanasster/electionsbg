// The one way to link to a company page from a CONTRACTOR key. Use this instead of
// hand-rolling `<Link to={`/company/${eik}`}>`.
//
// It exists for the same reason AwarderLink does — one invariant kept being
// forgotten at many call sites — but the invariant here is different: **not every
// supplier key is worth promising a page for.** `contracts.contractor_eik` carries
// 1,803 synthetic carriers (`obed-` / `ph-` / `np-`) and 282 ids that are neither
// those nor a plain EIK (the empty string among them), and `institution_identity()`
// returns NULL for all 2,085.
//
// ⚠ THAT DOES NOT MEAN THE PAGE 404s, AND THIS COMMENT SAID IT DID UNTIL
// 2026-08-19. `/company/:eik` falls back to a procurement-only body (8c8b9a9654,
// 2026-07-06) and reaches „Няма фирма с ЕИК … в базата." only when it has no
// contracts either — which a key drawn from `contracts.contractor_eik` never is.
// So the split below is editorial, not a servability test, and `isLinkableCompanyKey`
// is where it is argued. Do not re-derive it from „does the page exist".
//
// `obed-` carriers ARE linked: the carrier's page names its member firms, which is
// the only route from a dominated leaderboard row to the companies behind it.
// `ph-` (a registration number the buyer made up), `np-` (one natural person) and
// the foreign / malformed ids are NOT: those pages load, but the key names nothing
// a reader can check against any register.
//
// When the key is not linked this renders the name as plain text. It deliberately
// does NOT hide the row: the supplier is real and its money is real — Elsevier B.V.
// is a `ph-` key holding €32.8M — so it belongs on the leaderboard.
//
// ⚠ CONTRACTOR KEYS ONLY. `isLinkableCompanyKey` accepts the 9- and 13-digit forms
// `canonicalEik` emits plus `obed-`, which is exactly the contractor domain — but
// AWARDER keys are validated by `isValidEik`, which admits 9–13 digits, and two live
// awarders sit outside 9/13: ЕСО `1752013040` (10 digits, 10 rows) and АДФИ
// `175076479999` (12 digits). Both RESOLVE. Routing an awarder through this
// component de-links them, which is why the awarder row on /contract/:key
// deliberately does not use it, and why `SchoolProcurementTile`'s „виж поръчките на
// училището" (the school as a BUYER) is not one of this component's call sites.
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
  /** Associates the name with a footnote explaining what kind of key it is —
   *  e.g. the consortium note on SectorTopContractorsTile. Forwarded on BOTH
   *  branches: the keys most likely to need explaining (`obed-`, `ph-`, `np-`)
   *  are exactly the ones that render as plain text, so dropping it on the
   *  non-link branch would silence it precisely where it is needed. */
  "aria-describedby"?: string;
}> = ({ eik, children, className, title, "aria-describedby": describedBy }) => {
  // Carry the time scope, exactly as AwarderLink does: /company/:eik reads
  // useScope(), so a bare pathname silently resets a ?pscope=all view to the
  // default parliament window.
  const scopedHref = useScopedHref();
  const label = children ?? eik ?? "";

  if (!isLinkableCompanyKey(eik))
    return (
      <span
        className={withoutAffordance(className)}
        title={title}
        aria-describedby={describedBy}
      >
        {label}
      </span>
    );

  return (
    <Link
      to={scopedHref(`/company/${encodeURIComponent(eik!)}`)}
      className={className}
      title={title}
      aria-describedby={describedBy}
    >
      {label}
    </Link>
  );
};
