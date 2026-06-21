// Per-oblast procurement choropleth, rendered as three dashboard tiles (small
// multiples) — one per metric (total / per-capita / average contract value) —
// instead of one map behind metric-toggle buttons. Showing all three at once
// lets you read the spatial story of every metric in a single glance.
//
// Each tile is a ProcurementOblastMap (which owns its own colour scale and
// tooltip); this component just lays them out, labels each with its formula,
// and shares one legend. Clicking any oblast filters the settlements table.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { ProcurementOblastMap } from "@/screens/components/procurement/ProcurementOblastMap";
import { PROCUREMENT_RAMP } from "@/screens/components/procurement/procurementPalette";
import type { OblastMetric } from "@/data/procurement/useProcurementByOblast";

// Shared with the maps so the legend swatches match the fills exactly.
const RAMP = PROCUREMENT_RAMP;
const METRICS: OblastMetric[] = ["total", "perCapita", "avg"];

export const ProcurementChoroplethTile: FC<{
  /** Canonical code + name of the oblast currently filtering the table. */
  activeOblast?: { code: string; name: string } | null;
  onSelectOblast?: (canon: string, name: string) => void;
}> = ({ activeOblast, onSelectOblast }) => {
  const { t } = useTranslation();

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          {t("procurement_map_title") || "Local procurement by oblast"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {METRICS.map((m) => (
            <div key={m}>
              <div className="mb-1 min-h-[2.5rem]">
                <div className="text-sm font-medium">
                  {t(`procurement_map_metric_${m}`) || m}
                </div>
                <div className="text-[11px] leading-tight text-muted-foreground">
                  {t(`procurement_map_metric_${m}_desc`) || ""}
                </div>
              </div>
              <ProcurementOblastMap
                metric={m}
                activeCanon={activeOblast?.code ?? null}
                onSelectOblast={onSelectOblast}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>{t("procurement_map_low") || "lower"}</span>
          <div className="flex">
            {RAMP.map((c) => (
              <span
                key={c}
                className="h-3 w-5"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <span>{t("procurement_map_high") || "higher"}</span>
          <span className="ml-auto">
            {t("procurement_map_caveat") ||
              "Local-tier buyers only; national ministries excluded."}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};
