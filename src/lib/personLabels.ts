// Localized labels for the person layer's two code vocabularies — `person_role.role` and
// `person_source.facet`.
//
// Extracted so /persons (the browser) and /person/:slug (the profile) cannot drift into
// two vocabularies for the same codes. Both read the SAME `pp_role_*` / `pp_facet_*` keys,
// which already exist in both locales (43 role keys).
//
// `person_role.role` ALSO carries the 16 raw TR/NGO officer codes verbatim
// (`scripts/declarations/tr/types.ts`'s `TrRole` union — manager, partner, sole_owner,
// director, trustee, verifier, actual_owner, representative, …) whenever `source` is
// `tr`/`ngo`, because `resolve_persons.ts` inserts that column unchanged. Those codes have
// no `pp_role_*` entry — `pp_role_*` only covers governance offices — but they already have
// a complete BG/EN vocabulary under `tr_role_*` (see `src/lib/trRole.ts`, the shared label
// used across the company/officer surfaces). `roleLabel` therefore falls back to `tr_role_*`
// before giving up, so /persons doesn't grow a second incomplete vocabulary for codes a
// third file already translates in full.
//
// THE TWO VOCABULARIES CASE DIFFERENTLY, AND THE FALLBACK MUST NORMALIZE IT. `pp_role_*` is
// capitalized throughout, both locales ("Кмет", "Магистрат") — it was written for exactly
// this kind of standalone label (a dropdown option, a chip). `tr_role_*` is lowercase
// throughout ("съдружник", "управител") because its OTHER call sites are mid-sentence
// ("… е съдружник в тази фирма"), where a capital would be wrong. Surfacing the raw
// `tr_role_*` fallback here — a dropdown/chip context, same as `pp_role_*`'s own — would
// read as an inconsistency within one list, not as two vocabularies; `capitalizeFirstLetter`
// closes that gap on the fallback branch only, matching this file's own capitalized
// convention rather than the sentence-fragment convention the source string was written for.
//
// UNKNOWN CODES PASS THROUGH UNCHANGED, deliberately. The resolver mints role codes from
// the source data, so a new one appears in the corpus before anyone writes its label;
// showing the raw code ("eu_funds_controller") is ugly but true, whereas a generic
// "Друго" would silently merge distinct offices into one bucket — and in a FILTER dropdown
// that reads as though the register contains no such people.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { trRoleLabel } from "@/lib/trRole";
import { capitalizeFirstLetter } from "@/data/utils";

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

/** `pp_role_<code>`, falling back to the TR/NGO officer vocabulary (`tr_role_*`) rather
 *  than straight to the raw code — see the header comment for why `pp_role_*` alone
 *  doesn't cover these. */
const ppOrTrRoleLabel = (t: (k: string) => string, role: string): string => {
  const key = `pp_role_${role}`;
  const s = t(key);
  return s === key ? capitalizeFirstLetter(trRoleLabel(role, t)) : s;
};

/** Memoized on `t`, whose identity changes only on a language switch. Fresh function
 *  identities every render would invalidate every `useMemo` that lists these as
 *  dependencies — which on the /persons browser is the option lists and the column
 *  definitions, i.e. a full table re-render per keystroke. */
export const usePersonLabels = () => {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      /** `person_role.role` → localized office name (Кмет, Общински съветник, …), falling
       *  back to the TR/NGO officer vocabulary (`tr_role_*`) for the codes `pp_role_*` was
       *  never meant to cover. */
      roleLabel: (role: string | null | undefined): string =>
        role ? ppOrTrRoleLabel(t, role) : "",
      /** PLURAL role name, for a heading over a filtered set — „Народни представители"
       *  rather than „Народен представител" above 2,120 people. Falls back to the singular
       *  for the long tail of role codes that have no plural key: a singular heading is a
       *  worse one, never a wrong one, and there are ~60 codes of which a handful are ever
       *  landed on directly. TR/NGO officer codes have no plural key either, so they fall
       *  all the way to their (already-localized, via `tr_role_*`) singular. */
      rolePluralLabel: (role: string | null | undefined): string => {
        if (!role) return "";
        const plural = t(`pp_role_plural_${role}`, { defaultValue: "" });
        return plural || ppOrTrRoleLabel(t, role);
      },
      /** `person_source.facet` → localized group name (Политици, Изпълнителна власт, …). */
      facetLabel: (facet: string | null | undefined): string =>
        labelWith(t, "pp_facet_", facet),
    }),
    [t],
  );
};
