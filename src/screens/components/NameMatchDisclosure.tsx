// The footer caveat that qualifies a block of person↔organisation rows resting on a name.
//
// ONE definition, for the reason LinkBasisMark states about the inline „по име" mark: a
// reader must not be told two different things about two attributions made by one rule. This
// block was inline in PersonCompanies and ABSENT from the NGO block entirely, which is the
// worse half of that drift: 5,670 of 5,727 NGO board seats (4,887 people, measured
// 2026-08-25) rest on a folded name and were rendered with no mark and no caveat at all,
// directly beneath a companies list that marked every one of its own rows.
//
// ⚠️ FOUR SURFACES RENDER THIS CLAIM, NOT TWO — an earlier version of this header said two,
// which is how a fifth gets added without checking. What each carries, and why:
//
//   • PersonCompanies („Фирми")        — per-row mark + THIS block. The full treatment.
//   • PersonNgoSeats („Управа на ЮЛНЦ") — per-row mark + THIS block. Same, since 2026-08-25.
//   • MpManagementRoles                 — per-row mark only. It reads a bucket payload that
//     carries no `foldPeopleN`, so it cannot state the registry's count; the mark's tooltip
//     carries the sentence instead.
//   • ai/tools/person.ts                — neither, by construction: its output is a fact map
//     for a model, not markup. It qualifies the FACT KEY („фирми — по съвпадение на име")
//     so the caveat cannot be detached from the names it qualifies.
//
// The /persons browser is a fifth reader of the same sentence (PersonMoneyCells, as a cell
// tooltip) but of a per-person basis rather than a per-row one, so it is not a consumer of
// this component — only of NAMESAKE_FALLBACK.
//
// It pairs with LinkBasisMark, never replaces it: the mark says WHICH rows rest on a name,
// this says WHAT that means. A block renders it only when at least one of its rows actually
// is a name match — rendering it unconditionally tells the people whose every seat is
// register-confirmed that their own records might belong to somebody else.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { NAMESAKE_FALLBACK } from "./linkBasis";

export const NameMatchDisclosure: FC<{
  /** Distinct registry people on this person's fold; null/undefined = unmeasured. */
  foldPeopleN?: number | null;
}> = ({ foldPeopleN }) => {
  const { t } = useTranslation();
  return (
    <div className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
      <div>
        {t("person_namesake_disclosure", {
          defaultValue: NAMESAKE_FALLBACK,
        })}
      </div>
      {/* The registry's own count, when we have it. This is the difference between "we could
          not verify" and "the register itself lists N people under this name" — the second is
          a fact a reader can act on. Rendered ONLY for >1: null means unmeasured (see
          PersonProfile.foldPeopleN) and 1 needs no sentence. */}
      {foldPeopleN != null && foldPeopleN > 1 && (
        <div className="font-medium text-amber-700 dark:text-amber-400">
          {/* `n`, not i18next's `count`: passing `count` switches the lookup to the plural key
              family (…_one / …_other) and the defaultValue below stops being used, which
              renders the bare key to the reader. */}
          {t("pp_fold_people_n", {
            n: foldPeopleN,
            defaultValue:
              "Търговският регистър съдържа поне {{n}} различни лица с това име.",
          })}
        </div>
      )}
    </div>
  );
};
