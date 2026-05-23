// Small pill button that toggles peer-country lines on every
// GovernmentTimeline chart in the IndicatorsScreen. State is owned by the
// parent (via useCompareToggle) so the same flag controls every section
// simultaneously — a user who turns it on once sees peers everywhere.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { GitCompareArrows } from "lucide-react";
import { cn } from "@/lib/utils";

export const CompareToggleButton: FC<{
  enabled: boolean;
  onToggle: () => void;
  className?: string;
}> = ({ enabled, onToggle, className }) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] transition-colors",
        enabled
          ? "bg-foreground text-background border-transparent"
          : "bg-background text-muted-foreground border-border hover:bg-accent/10",
        className,
      )}
      title={t(
        enabled
          ? "indicators_compare_toggle_off_tooltip"
          : "indicators_compare_toggle_on_tooltip",
      )}
    >
      <GitCompareArrows className="h-3 w-3" aria-hidden />
      <span>{t("indicators_compare_toggle_label")}</span>
    </button>
  );
};
