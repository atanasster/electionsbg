// "We hold no roll-call for these terms" and "this MP never voted" are different facts, and
// the person page used to render them identically — as nothing at all. Every roll-call block
// self-hides when empty, so a pre-2020 MP's profile simply had no voting section and no
// explanation for its absence.
//
// The sibling of PersonNoDeclarationNote, and deliberately the same SHAPE as it: a standalone
// component with its own test, so the one condition that decides whether the site publishes a
// claim about a named person can be mounted and asserted directly.
//
// THE CLAIM IS ONLY MADE ON A PROVEN NEGATIVE. `rollcallCoverage` returns `false` only when
// the corpus has no seat for this person under any id or spelling AND every parliament they
// sat in predates it; every uncertain path returns `null` and this renders nothing. The first
// cut of this note reasoned from `nsFolders` alone and was wrong for 70 of the 293 MPs it
// targeted — it told people whose votes the site was holding that no record existed, turning
// an internal id-linking gap into an accusation against the National Assembly.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  rollcallCoverage,
  ROLLCALL_FIRST_NS,
  ROLLCALL_FIRST_SITTING,
} from "@/data/parliament/rollcallCoverage";
import { nsOrdinal } from "@/data/parliament/nsOrdinal";

export const PersonNoRollcallNote: FC<{
  nsFolders?: readonly string[] | null;
  /** `mp_entry().hasRollcall` — the authoritative corpus-membership answer. */
  hasRollcall?: boolean | null;
}> = ({ nsFolders, hasRollcall }) => {
  const { t, i18n } = useTranslation();
  if (rollcallCoverage(nsFolders, hasRollcall) !== false) return null;

  const lang = i18n.language ?? "bg";
  return (
    <p className="my-4 text-xs text-muted-foreground">
      {t("mp_rollcall_out_of_corpus", {
        // Ordinalised at the call site, never as a hard-coded suffix in the string: BG
        // takes four different endings (-во/-ро/-мо/-то) and EN four (st/nd/rd/th), so a
        // literal „-то" around the number is correct for 44 and wrong for most values a
        // backfill would produce. The number and its suffix must move together.
        firstNs: nsOrdinal(String(ROLLCALL_FIRST_NS), lang),
        // The date follows the same constant rather than being spelled in the copy, so a
        // backfill cannot leave the two halves of the sentence disagreeing.
        // `month: "long"`, not "short": bg-BG renders the short form as a NUMBER
        // ("10.2020 г."), which reads as a date fragment rather than a month.
        since: new Date(
          `${ROLLCALL_FIRST_SITTING}T00:00:00Z`,
        ).toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
          year: "numeric",
          month: "long",
          timeZone: "UTC",
        }),
      })}
    </p>
  );
};
