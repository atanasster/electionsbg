// The small „по име" mark on a person↔company link that rests on a name rather than on a
// curated register.
//
// ONE definition, used by every surface that renders a company beside a named person — the
// /person profile's companies list (PersonCompanies) and its registry-roles block
// (MpManagementRoles), which sit on THE SAME PAGE. Two marks with two wordings on one profile
// is the drift tr-attribution-basis-v1 §0.2 calls the worst defect this family can carry, and
// it was already possible: PersonCompanies carried this inline while the roles block below it
// still showed a high/medium confidence badge minted by a different rule entirely.
//
// The server decides the basis, not the client — `linkBasis` comes from
// `person_company_bridge_a` (148) through both 082 and 150, so the two blocks read one view.

import { FC } from "react";
import { useTranslation } from "react-i18next";

/** The server's basis for a person↔company link, as 082 and 150 both emit it. */
export type LinkBasis = "declared" | "name_match";

/** Absent linkBasis is treated as a name match, never as declared.
 *
 *  A cloud database still serving a 082/150 older than tr-attribution-basis-v1 omits the
 *  field, and the two ways to be wrong are not symmetric: calling a curated link a name match
 *  costs a caveat nobody needed, while calling a name match "declared" tells a reader we
 *  confirmed a company belongs to a named person when we did not. */
export const isNameMatch = (linkBasis?: string | null): boolean =>
  linkBasis !== "declared";

export const LinkBasisMark: FC<{
  /** Tooltip text — the surface supplies it, since the surrounding sentence differs. */
  label: string;
}> = ({ label }) => {
  const { t } = useTranslation();
  return (
    <span
      className="ml-1 shrink-0 whitespace-nowrap rounded-full bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300"
      title={label}
    >
      {t("pp_link_name_match", { defaultValue: "по име" })}
    </span>
  );
};
