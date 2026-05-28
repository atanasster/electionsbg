// Persistent header chip showing the active My-Area anchor. Mirrors the
// CabinetAnchorPill pattern: colored marker + place name + × button to clear.
//
// Unlike the cabinet pill, the area pill is GLOBAL — the AreaAnchorProvider
// is mounted at the root, so this chip auto-hides only when no `?area=` is
// set (independent of which route the user is on). Clicking the body
// navigates to /my-area/<id>; × clears the anchor.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAreaAnchor, useSetAreaAnchor } from "@/data/area/areaAnchor";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { Tooltip as UxTooltip } from "@/ux/Tooltip";

export const AreaPill: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";
  const anchor = useAreaAnchor();
  const setAnchor = useSetAreaAnchor();
  const navigate = useNavigate();
  const location = useLocation();
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();

  if (!anchor) return null;

  // Resolve the name on demand — both lookups are O(1) over already-cached
  // React Query data, no fetch cost. The pill renders fine with the raw id
  // while data is loading on first paint.
  let name: string | null = null;
  if (/^\d+$/.test(anchor.id)) {
    const s = findSettlement(anchor.id);
    if (s) name = lang === "bg" ? s.name : s.name_en;
  } else {
    const m = findMunicipality(anchor.id);
    if (m) name = lang === "bg" ? m.name : m.name_en;
  }
  const display = name ?? anchor.id;
  const labelPrefix = t("area_pill_label");
  const tooltipText = t("area_pill_tooltip");
  const clearLabel = t("area_pill_clear");

  return (
    <div
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-md border text-xs font-medium",
        "border-primary/40 bg-primary/[0.06]",
      )}
    >
      <UxTooltip content={<span>{tooltipText}</span>}>
        <button
          type="button"
          aria-label={t("area_pill_aria", { name: display })}
          onClick={() => navigate(`/my-area/${anchor.id}`)}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 whitespace-nowrap transition-colors",
            "text-foreground hover:bg-primary/[0.12]",
            "focus:outline-none focus-visible:bg-primary/[0.18]",
          )}
        >
          <MapPin aria-hidden className="inline-block size-3 text-primary" />
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {labelPrefix}
          </span>
          <span className="truncate max-w-[14ch]">{display}</span>
        </button>
      </UxTooltip>
      <span aria-hidden className="w-px bg-primary/30" />
      <button
        type="button"
        aria-label={clearLabel}
        onClick={() => {
          setAnchor(null);
          // When the user is currently ON a /my-area/<id> route, the
          // path itself is what AreaAnchorProvider reads — clearing
          // ?area= alone would leave the path-derived anchor live and
          // the pill would re-render immediately. Navigate away first
          // so the clear sticks.
          if (/^(?:\/en)?\/my-area\/.+/.test(location.pathname)) {
            navigate("/my-area");
          }
        }}
        className={cn(
          "flex items-center px-1.5 text-muted-foreground transition-colors",
          "hover:bg-primary/[0.18] hover:text-foreground",
          "focus:outline-none focus-visible:bg-primary/[0.18]",
        )}
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
};
