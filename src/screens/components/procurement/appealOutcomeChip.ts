// The awarder appeals tile's chip text + tone. Pure, and in its own module so it
// is testable without rendering the tile — and because a component file that also
// exports helpers breaks Fast Refresh (react-refresh/only-export-components).
//
// The one rule here: TEXT always comes from the shared label map in
// src/lib/kzkLabels.ts, and this file decides only COLOUR. The tile used to
// hardcode "upheld" / "rejected" for two of the branches, so an edit to
// OUTCOME_EN reached every appeals surface except this one.

import {
  kzkOutcomeLabel,
  kzkStatusLabel,
  isUpheldOutcome,
} from "@/lib/kzkLabels";

/**
 * Colour for a merits outcome.
 *
 * Red is a finding AGAINST the buyer, so it goes through the shared
 * `isUpheldOutcome` rather than a local `=== "уважена"`: that is the same
 * predicate `upheld_ocids` and the contract Corruption Risk Index use, and a
 * stray-cased value must not colour this chip differently from how the rest of
 * the site scores it.
 *
 * Everything else is neutral. A refusal to open proceedings (`отказана`,
 * derived by `kzk_effective_outcome` in 042) is deliberately among them: it is
 * the absence of a hearing, not a finding either way.
 */
export const outcomeTone = (outcome: string | null): string =>
  isUpheldOutcome(outcome)
    ? "bg-red-500/15 text-red-700 dark:text-red-300"
    : (outcome ?? "").trim().toLowerCase() === "отхвърлена"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : "bg-muted text-muted-foreground";

/** Chip text + classes for one appeal row. */
export const outcomeChip = (
  outcome: string | null,
  status: string | null,
  bg: boolean,
): { text: string; cls: string } => {
  const lang = bg ? "bg" : "en";
  // Every non-null outcome routes through kzkOutcomeLabel — including the derived
  // `отказана`, which is OUR code and not a word the register ever prints, so
  // printing it raw would put invented terminology on the page.
  if (outcome)
    return { text: kzkOutcomeLabel(outcome, lang), cls: outcomeTone(outcome) };
  return {
    // Through kzkStatusLabel, not raw: this branch covers the 3,271 appeals with
    // no published ending, and printing `status` directly showed Bulgarian to
    // English readers on every one of them.
    text: kzkStatusLabel(status, lang) || (bg ? "в производство" : "pending"),
    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  };
};
