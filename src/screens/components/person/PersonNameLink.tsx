// A person's name, linked to their unified profile when one exists, else plain text.
//
// Used across the local-elections dashboards (mayors, councillors, village/район mayors). The
// link target is baked onto each record offline, so this does NO runtime lookup:
//   - `mpId`      → /candidate/mp-{id}  (the already-prerendered/indexed MP dashboard; preferred
//                    so seated MPs land on their canonical indexed URL, matching ChmiFeedScreen)
//   - `personSlug`→ /person/{slug}      (the baked unified-person slug — Phase 2 stamps it)
//   - neither     → plain text          (no profile exists — e.g. a losing candidate)
//
// Uses the shared param-preserving Link so the election/scope context (?elections=…) survives the
// navigation, exactly as the surrounding local pages expect.

import { FC } from "react";
import { Link } from "@/ux/Link";
import { titleCaseName } from "@/lib/utils";

export const PersonNameLink: FC<{
  name: string;
  personSlug?: string | null;
  mpId?: number | null;
  className?: string;
}> = ({ name, personSlug, mpId, className }) => {
  const to =
    mpId != null
      ? `/candidate/mp-${mpId}`
      : personSlug
        ? `/person/${personSlug}`
        : undefined;
  const label = titleCaseName(name);
  return to ? (
    <Link to={to} className={className}>
      {label}
    </Link>
  ) : (
    <span className={className}>{label}</span>
  );
};
