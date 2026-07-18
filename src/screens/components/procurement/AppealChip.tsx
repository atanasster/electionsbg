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

// Larger rounded-full badge (detail-page `pill` variant only).
const PILL_TONE: Record<"amber" | "red" | "muted", string> = {
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  muted: "bg-muted text-muted-foreground",
};

export const AppealChip: FC<{
  suspended?: boolean;
  /** Larger rounded-full badge for the detail pages (default: the table pill). */
  pill?: boolean;
  /** Override the colour (default: red when suspended, else amber). `muted` is
   *  for a neutral outcome/status badge. */
  tone?: "amber" | "red" | "muted";
  label?: string;
  className?: string;
}> = ({ suspended = false, pill = false, tone, label, className = "" }) => {
  const { t } = useTranslation();
  const resolved: SignalTone = tone ?? (suspended ? "red" : "amber");
  const text =
    label ??
    (suspended
      ? t("appeals_feed_suspended") || "suspended"
      : t("tender_appealed") || "Appealed (КЗК)");

  if (pill) {
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${PILL_TONE[resolved as "amber" | "red" | "muted"]} ${className}`}
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
