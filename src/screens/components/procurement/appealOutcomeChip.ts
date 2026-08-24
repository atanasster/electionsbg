// The awarder appeals tile's chip text + tone. Pure, and in its own module so it
// is testable without rendering the tile — and because a component file that also
// exports helpers breaks Fast Refresh (react-refresh/only-export-components).
//
// Two rules, and between them this module owns NEITHER the words nor the pixels.
// TEXT comes from the shared label map in src/lib/kzkLabels.ts — the tile used to
// hardcode "upheld" / "rejected", so an edit to OUTCOME_EN reached every appeals
// surface except that one. COLOUR is a tone NAME from AppealChip, which owns the
// classes — the tile used to hand-roll them and had already drifted from the two
// sibling appeal surfaces. All this file decides is which outcome means what.
//
// `outcomeTone` is READ BY /procurement/appeals too (AppealsBrowserDbScreen),
// which the awarder tile links straight to. That page carried its own two-way
// `isUpheldOutcome(o) ? "red" : "muted"`, so a merits rejection was emerald on
// the tile and muted one click later. One rule now, in one place.

import {
  kzkOutcomeLabel,
  kzkStatusLabel,
  isUpheldOutcome,
} from "@/lib/kzkLabels";
import type { AppealTone } from "./AppealChip";

/**
 * Tone for a merits outcome — a NAME from AppealChip's palette, never Tailwind
 * classes. The tile used to carry its own `bg-red-500/15` etc., which is the
 * drift AppealChip was extracted to end (it had already diverged: `red-500/15`
 * here vs `red-100` there).
 *
 * Red is a finding AGAINST the buyer, so it goes through the shared
 * `isUpheldOutcome` rather than a local `=== "уважена"`: that is the same
 * predicate `upheld_ocids` and the contract Corruption Risk Index use, and a
 * stray-cased value must not colour this chip differently from how the rest of
 * the site scores it.
 *
 * Emerald is the merits REJECTION — the buyer was found for. Everything else is
 * muted, which reads as "no verdict either way": a terminated case, and the
 * derived `отказана` (КЗК refused to open proceedings; `kzk_effective_outcome`
 * in 042), which is the absence of a hearing rather than a finding.
 */
export const outcomeTone = (outcome: string | null): AppealTone =>
  isUpheldOutcome(outcome)
    ? "red"
    : (outcome ?? "").trim().toLowerCase() === "отхвърлена"
      ? "emerald"
      : "muted";

/** Chip text + tone for one appeal row. Rendered by `AppealChip`. */
export const outcomeChip = (
  outcome: string | null,
  status: string | null,
  bg: boolean,
): { text: string; tone: AppealTone } => {
  const lang = bg ? "bg" : "en";
  // Every non-null outcome routes through kzkOutcomeLabel — including the derived
  // `отказана`, which is OUR code and not a word the register ever prints, so
  // printing it raw would put invented terminology on the page.
  if (outcome)
    return { text: kzkOutcomeLabel(outcome, lang), tone: outcomeTone(outcome) };
  return {
    // Through kzkStatusLabel, not raw: this branch covers the 3,271 appeals with
    // no published ending, and printing `status` directly showed Bulgarian to
    // English readers on every one of them.
    text: kzkStatusLabel(status, lang) || (bg ? "в производство" : "pending"),
    // Amber = still in play, matching AppealChip's own default for an appealed
    // procedure.
    tone: "amber",
  };
};
