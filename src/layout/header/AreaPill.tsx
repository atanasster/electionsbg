// Persistent header chip showing the active My-Area anchor. Mirrors the
// CabinetAnchorPill pattern: colored marker + place name + × button to clear.
//
// Unlike the cabinet pill, the area pill is GLOBAL — the AreaAnchorProvider
// is mounted at the root, so this chip auto-hides only when no `?area=` is
// set (independent of which route the user is on). Clicking the body
// navigates to /governance/<id>; × clears the anchor.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAreaAnchor, useSetAreaAnchor } from "@/data/area/areaAnchor";
import { useAreaResolver } from "@/data/area/useAreaResolver";
import { Tooltip as UxTooltip } from "@/ux/Tooltip";

export const AreaPill: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";
  const anchor = useAreaAnchor();
  const setAnchor = useSetAreaAnchor();
  const navigate = useNavigate();
  const location = useLocation();
  // Resolve via the shared area resolver (O(1) over already-cached React
  // Query data) so synthetic aggregates like Sofia city (SOF00 — no
  // município row) get a localized name instead of the raw code. The pill
  // renders fine with the raw id while data is loading on first paint.
  const area = useAreaResolver(anchor?.id);

  if (!anchor) return null;

  let name: string | null = null;
  if (area?.kind === "settlement") {
    name = lang === "bg" ? area.settlement.name : area.settlement.name_en;
  } else if (area?.kind === "municipality") {
    name = lang === "bg" ? area.municipality.name : area.municipality.name_en;
  } else if (area?.kind === "rayon") {
    name = lang === "bg" ? area.rayon.labelBg : area.rayon.labelEn;
  }
  const display = name ?? anchor.id;
  const labelPrefix = t("area_pill_label");
  const tooltipText = t("area_pill_tooltip");
  const clearLabel = t("area_pill_clear");

  return (
    <div
      className={cn(
        // min-w-0 lets the pill shrink (and its name truncate) instead of
        // wrapping to a second header row when the row gets tight; the
        // overflow-hidden clips whatever the inner truncation can't.
        "inline-flex min-w-0 items-stretch overflow-hidden rounded-md border text-xs font-medium",
        "border-primary/40 bg-primary/[0.06]",
      )}
    >
      <UxTooltip content={<span>{tooltipText}</span>}>
        <button
          type="button"
          aria-label={t("area_pill_aria", { name: display })}
          onClick={() => navigate(`/governance/${anchor.id}`)}
          className={cn(
            "flex min-w-0 items-center gap-1.5 px-2 py-1 whitespace-nowrap transition-colors",
            "text-foreground hover:bg-primary/[0.12]",
            "focus:outline-none focus-visible:bg-primary/[0.18]",
          )}
        >
          <MapPin
            aria-hidden
            className="inline-block size-3 shrink-0 text-primary"
          />
          {/* Prefix label dropped below xl so the pill can spend its width on
              the place name instead of the "РАЙОН/ОБЩ" prefix when the row is
              tight (mobile, and the lg menu-bar band); restored at xl. The
              MapPin already signals "place". */}
          <span className="hidden xl:inline shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            {labelPrefix}
          </span>
          <span className="truncate min-w-0 max-w-[7ch] sm:max-w-[14ch]">
            {display}
          </span>
        </button>
      </UxTooltip>
      <span aria-hidden className="w-px bg-primary/30" />
      <button
        type="button"
        aria-label={clearLabel}
        onClick={() => {
          setAnchor(null);
          // When the user is currently ON a /governance/<id> route, the
          // path itself is what AreaAnchorProvider reads — clearing
          // ?area= alone would leave the path-derived anchor live and
          // the pill would re-render immediately. Navigate away first
          // so the clear sticks. (region/country nodes aren't anchors.)
          if (
            /^(?:\/en)?\/governance\/(?!region(?:\/|$)).+/.test(
              location.pathname,
            )
          ) {
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
