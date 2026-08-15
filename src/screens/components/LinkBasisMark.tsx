// The small „по име" mark on a person↔company link that rests on a name rather than on a
// curated register.
//
// ONE definition, used by every surface that renders a company beside a named person — the
// profile's companies list (PersonCompanies) and its registry-roles block (MpManagementRoles).
// Those are mutually exclusive branches of CandidateScreen rather than literally one page, but
// they answer the same question about the same person, so a reader arriving by either route
// must not be told two different things. Two marks with two wordings is the drift
// tr-attribution-basis-v1 §0.2 calls the worst defect this family can carry, and it was
// already live: PersonCompanies carried this inline while the roles block still showed a
// high/medium confidence badge minted by a different rule entirely.
//
// The rule that decides WHICH links get the mark is `isNameMatch`, in ./linkBasis.

import { FC } from "react";
import { useTranslation } from "react-i18next";

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
