// Localized labels for the person layer's two code vocabularies — `person_role.role` and
// `person_source.facet`.
//
// Extracted so /persons (the browser) and /person/:slug (the profile) cannot drift into
// two vocabularies for the same codes. Both read the SAME `pp_role_*` / `pp_facet_*` keys,
// which already exist in both locales (43 role keys).
//
// UNKNOWN CODES PASS THROUGH UNCHANGED, deliberately. The resolver mints role codes from
// the source data, so a new one appears in the corpus before anyone writes its label;
// showing the raw code ("eu_funds_controller") is ugly but true, whereas a generic
// "Друго" would silently merge distinct offices into one bucket — and in a FILTER dropdown
// that reads as though the register contains no such people.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

/** Label a code against a `<prefix><code>` i18n key, falling back to the code itself when
 *  no key exists. `t()` returns the key when it is missing, which is what makes the
 *  pass-through detectable. */
const labelWith = (
  t: (k: string) => string,
  prefix: string,
  code: string | null | undefined,
): string => {
  if (!code) return "";
  const key = `${prefix}${code}`;
  const s = t(key);
  return s === key ? code : s;
};

/** Memoized on `t`, whose identity changes only on a language switch. Fresh function
 *  identities every render would invalidate every `useMemo` that lists these as
 *  dependencies — which on the /persons browser is the option lists and the column
 *  definitions, i.e. a full table re-render per keystroke. */
export const usePersonLabels = () => {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      /** `person_role.role` → localized office name (Кмет, Общински съветник, …). */
      roleLabel: (role: string | null | undefined): string =>
        labelWith(t, "pp_role_", role),
      /** PLURAL role name, for a heading over a filtered set — „Народни представители"
       *  rather than „Народен представител" above 2,120 people. Falls back to the singular
       *  for the long tail of role codes that have no plural key: a singular heading is a
       *  worse one, never a wrong one, and there are ~60 codes of which a handful are ever
       *  landed on directly. */
      rolePluralLabel: (role: string | null | undefined): string => {
        if (!role) return "";
        const plural = t(`pp_role_plural_${role}`, { defaultValue: "" });
        return plural || labelWith(t, "pp_role_", role);
      },
      /** `person_source.facet` → localized group name (Политици, Изпълнителна власт, …). */
      facetLabel: (facet: string | null | undefined): string =>
        labelWith(t, "pp_facet_", facet),
    }),
    [t],
  );
};
