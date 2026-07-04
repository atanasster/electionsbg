// Shared "КЗК appeal" row chip — amber for an appealed procedure, red when the
// procedure was suspended (спряно). `suspended` picks the tone; `pill` switches
// the shape (rounded-full pill vs the default rounded chip) so callers don't
// stack competing `rounded-full`/`rounded` utilities; `label` overrides the text
// (the detail page's "Under appeal (КЗК)" / "Procedure suspended" copy differs
// from the browsers' "Appealed (КЗК)" / "suspended"). Extracted so every surface
// stops copy-pasting the amber/red markup (which had drifted in radius/case/shade).

import { FC } from "react";
import { useTranslation } from "react-i18next";

const TONE = {
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  muted: "bg-muted text-muted-foreground",
} as const;

export const AppealChip: FC<{
  suspended?: boolean;
  pill?: boolean;
  /** Override the colour (default: red when suspended, else amber). `muted` is
   *  for a neutral outcome/status badge that reuses this chip's shape. */
  tone?: keyof typeof TONE;
  label?: string;
  className?: string;
}> = ({ suspended = false, pill = false, tone, label, className = "" }) => {
  const { t } = useTranslation();
  const toneClass = TONE[tone ?? (suspended ? "red" : "amber")];
  const shape = pill ? "rounded-full px-2" : "rounded px-1.5";
  const text =
    label ??
    (suspended
      ? t("appeals_feed_suspended") || "suspended"
      : t("tender_appealed") || "Appealed (КЗК)");
  return (
    <span
      className={`inline-flex items-center ${shape} py-0.5 text-[10px] font-medium ${toneClass} ${className}`}
    >
      {text}
    </span>
  );
};
