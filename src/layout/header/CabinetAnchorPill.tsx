// Persistent header chip showing the active cabinet anchor on the
// governments + indicators route group. Reads useCabinetAnchor() (returns
// null outside the provider) so the chip auto-hides on unrelated routes
// without any path checks.
//
// Visual: colored dot (cabinet's canonical party color) + PM surname + ×
// button to clear. Clicking the body navigates to the cabinet-detail page;
// clicking × clears the ?cabinet= URL param. Tooltip on the body explains
// what "anchored" means for first-time visitors.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCabinetAnchor,
  useSetCabinetAnchor,
} from "@/data/macro/cabinetAnchorContext";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { colorForGovernmentSolid } from "@/screens/components/governments/governmentColors";
import { Tooltip as UxTooltip } from "@/ux/Tooltip";

export const CabinetAnchorPill: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";
  const anchor = useCabinetAnchor();
  const setAnchor = useSetCabinetAnchor();
  const navigate = useNavigate();
  const { colorFor } = useCanonicalParties();

  if (!anchor) return null;

  const g = anchor.cabinet;
  const surname = (lang === "bg" ? g.pmBg : g.pmEn).split(" ").pop() ?? "";
  const color = colorForGovernmentSolid(g, colorFor);
  const labelPrefix = t("cabinet_anchor_pill_label");
  const tooltipText = t("cabinet_anchor_pill_tooltip");
  const clearLabel = t("cabinet_anchor_pill_clear");

  return (
    <div
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-md border text-xs font-medium",
        "border-amber-500/50 bg-amber-500/[0.06]",
      )}
    >
      <UxTooltip content={<span>{tooltipText}</span>}>
        <button
          type="button"
          onClick={() => navigate(`/governments/${encodeURIComponent(g.id)}`)}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 whitespace-nowrap transition-colors",
            "text-foreground hover:bg-amber-500/[0.12]",
            "focus:outline-none focus-visible:bg-amber-500/[0.18]",
          )}
        >
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {labelPrefix}
          </span>
          <span className="truncate max-w-[10ch]">{surname}</span>
        </button>
      </UxTooltip>
      <span aria-hidden className="w-px bg-amber-500/30" />
      <button
        type="button"
        aria-label={clearLabel}
        onClick={() => setAnchor(null)}
        className={cn(
          "flex items-center px-1.5 text-muted-foreground transition-colors",
          "hover:bg-amber-500/[0.18] hover:text-foreground",
          "focus:outline-none focus-visible:bg-amber-500/[0.18]",
        )}
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
};
