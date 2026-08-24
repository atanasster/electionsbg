// Shared "КЗК appeal" row chip — amber for an appealed procedure, red when the
// procedure was suspended (спряно). `suspended` picks the tone; `pill` switches
// to the larger rounded-full badge used on the detail pages (vs the default
// table SignalPill); `label` overrides the text (the detail page's "Under appeal
// (КЗК)" / "Procedure suspended" copy differs from the browsers' "Appealed
// (КЗК)" / "suspended"). Extracted so every surface stops copy-pasting the
// amber/red markup (which had drifted in radius/case/shade); the table variant
// now shares SignalPill so appeal chips line up with the other signal pills.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  SignalPill,
  type SignalTone,
} from "@/screens/components/procurement/SignalPill";

/** The tones an appeal chip may take. A SUBSET of SignalTone, deliberately: this
 *  chip carries a verdict about a named buyer, so the palette is the four states
 *  an appeal can be in and not the full signal vocabulary.
 *
 *  `emerald` is the merits REJECTION — КЗК heard the complaint and found for the
 *  buyer. It is the only tone here that is good news for the awarder, which is
 *  why it cannot collapse into `muted`: muted is "no verdict either way"
 *  (a terminated case, a refused proceeding), and showing a buyer's win as
 *  no-verdict understates a real finding in their favour.
 *
 *  `Extract` rather than a bare union so the subset is CHECKED: a member
 *  SignalPill does not carry would silently become `never` here and fail at
 *  PILL_TONE, instead of reaching the non-pill branch and rendering untinted. */
export type AppealTone = Extract<
  SignalTone,
  "amber" | "red" | "emerald" | "muted"
>;

// Larger rounded-full badge (detail-page `pill` variant only). Kept in step with
// SignalPill's TONE map — same hue per tone, lighter weight for the badge.
const PILL_TONE: Record<AppealTone, string> = {
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  emerald:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  muted: "bg-muted text-muted-foreground",
};

export const AppealChip: FC<{
  suspended?: boolean;
  /** Larger rounded-full badge for the detail pages (default: the table pill). */
  pill?: boolean;
  /** Override the colour (default: red when suspended, else amber). `muted` is
   *  for a neutral outcome/status badge; `emerald` for a merits rejection. */
  tone?: AppealTone;
  label?: string;
  className?: string;
}> = ({ suspended = false, pill = false, tone, label, className = "" }) => {
  const { t } = useTranslation();
  // Typed AppealTone, NOT SignalTone — the wider type would need a cast to index
  // PILL_TONE, and a cast is exactly what would hide the bug: widen `tone` to the
  // full SignalTone vocabulary one day and `PILL_TONE["teal"]` is undefined,
  // which interpolates into the className as the literal "undefined" and renders
  // an untinted chip at a 200. AppealTone is assignable to SignalTone, so the
  // SignalPill branch below still typechecks with no cast either.
  const resolved: AppealTone = tone ?? (suspended ? "red" : "amber");
  const text =
    label ??
    (suspended
      ? t("appeals_feed_suspended") || "suspended"
      : t("tender_appealed") || "Appealed (КЗК)");

  if (pill) {
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${PILL_TONE[resolved]} ${className}`}
      >
        {text}
      </span>
    );
  }

  return (
    <SignalPill tone={resolved} className={className}>
      {text}
    </SignalPill>
  );
};
