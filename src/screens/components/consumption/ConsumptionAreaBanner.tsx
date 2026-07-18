// Anchor-aware CTA on the Consumption hub. When the user has an area anchor
// (?area=<id>) set, it offers a one-tap link into that place's consumption
// dashboard; otherwise it surfaces the location picker (the shared
// AreaSniperButton, pointed at /consumption so choosing an area opens the
// per-place dashboard rather than the Governance one). The anchor itself is
// URL-only — this banner is the entry point that puts it there.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { MapPin, ArrowRight } from "lucide-react";
import { Link } from "@/ux/Link";
import { useAreaAnchor } from "@/data/area/areaAnchor";
import { useAreaResolver } from "@/data/area/useAreaResolver";
import { AreaSniperButton } from "@/layout/header/AreaSniperButton";

export const ConsumptionAreaBanner: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const T = (b: string, e: string) => (bg ? b : e);
  const anchor = useAreaAnchor();
  const area = useAreaResolver(anchor?.id);

  let name: string | null = null;
  if (area?.kind === "settlement") {
    name = bg ? area.settlement.name : area.settlement.name_en;
  } else if (area?.kind === "municipality") {
    name = bg ? area.municipality.name : area.municipality.name_en;
  }

  return (
    <div className="mt-4 rounded-lg border bg-card px-4 py-3 flex items-center gap-3 flex-wrap">
      <MapPin className="size-5 shrink-0 text-primary" />
      {anchor ? (
        // An anchor exists → always offer the drill-down. The resolved name is
        // shown once the settlements/municipalities blobs load; branching on
        // `name` here would flash the picker during that async window (and
        // permanently for an id that never resolves).
        <>
          <span className="text-sm min-w-0">
            {name ? (
              <>
                {T("Вашето място:", "Your place:")}{" "}
                <span className="font-semibold">{name}</span>
              </>
            ) : (
              T("Вашето място", "Your place")
            )}
          </span>
          <Link
            to={`/consumption/${anchor.id}`}
            className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            {T("Виж цените край вас", "See prices near you")}
            <ArrowRight className="size-4" />
          </Link>
        </>
      ) : (
        <>
          <span className="text-sm min-w-0">
            {T(
              "Вижте цените и промоциите във вашето населено място",
              "See prices and promotions in your settlement",
            )}
          </span>
          <div className="ml-auto shrink-0">
            <AreaSniperButton basePath="/consumption" />
          </div>
        </>
      )}
    </div>
  );
};
