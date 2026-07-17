// „Европейски средства (ИСУН) по област" — the per-oblast money map. Where does the EU
// money land, per oblast, in total and per resident. Reuses the shared OblastChoropleth
// (Sofia-merged geometry, percentile colour, tooltip). A total⇄per-capita toggle switches
// the metric. This is the „Kohesio for BG" tile — our ИСУН corpus surfaced per oblast (§2).
//
// ⚠ ALL ИСУН funds (every OP + the RRF), geo-attributed to the beneficiary — so Sofia city
// is inflated by nationally-run programmes headquartered there. The caption discloses this;
// the per-capita view and the convergence scatter are the honest cuts. The two МРРБ regional
// OPs specifically are in the cohesion burn-down tile above.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { OblastChoropleth } from "@/screens/components/procurement/OblastChoropleth";
import { PROCUREMENT_RAMP } from "@/screens/components/procurement/procurementPalette";
import type { RegionalOblastAgg } from "@/data/procurement/useRegionalOblast";

type Metric = "total" | "perCapita";

export const RegionalOblastMapTile: FC<{ oblasts: RegionalOblastAgg[] }> = ({
  oblasts,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const [metric, setMetric] = useState<Metric>("perCapita");

  const { values, names } = useMemo(() => {
    const values = new Map<string, number | undefined>();
    const names = new Map<string, string>();
    for (const o of oblasts) {
      names.set(o.canon, o.name);
      values.set(
        o.canon,
        metric === "total" ? o.contractedEur : o.perCapitaEur,
      );
    }
    return { values, names };
  }, [oblasts, metric]);

  if (oblasts.length < 4) return null;

  const fmt = (v: number | undefined): string => {
    if (v == null) return "—";
    return metric === "perCapita"
      ? `${formatEur(v, lang)}/${bg ? "жит." : "cap"}`
      : formatEurCompact(v, lang);
  };

  const btn = (m: Metric, label: string) => (
    <button
      type="button"
      onClick={() => setMetric(m)}
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
        metric === m
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-muted/70"
      }`}
    >
      {label}
    </button>
  );

  return (
    <Card id="regional-oblast-map" data-og="regional-oblast-map">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MapIcon className="h-4 w-4" />
            {bg
              ? "Европейски средства (ИСУН) по област"
              : "EU funds (ИСУН) by oblast"}
          </CardTitle>
          <div className="flex gap-1">
            {btn("perCapita", bg ? "на жител" : "per capita")}
            {btn("total", bg ? "общо" : "total")}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2">
        <OblastChoropleth
          values={values}
          names={names}
          ramp={PROCUREMENT_RAMP}
          formatValue={fmt}
          ariaLabel={
            bg
              ? "Карта: европейски средства по област"
              : "Map: EU funds by oblast"
          }
        />
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Договорени европейски средства (всички фондове по ИСУН, вкл. ПВУ), обобщени по област от общинско ниво. Всеки проект е отнесен към бенефициента, затова София (столица) е завишена от национални програми със седалище там — виж изгледа „на жител“ и разсейката по-долу за по-честната картина. Двете регионални програми на МРРБ поотделно са в усвояването по-горе."
            : "Contracted EU funds (all ИСУН funds incl. the RRF), aggregated to oblast from the municipal level. Each project is attributed to its beneficiary, so Sofia (capital) is inflated by nationally-run programmes headquartered there — see the per-capita view and the scatter below for the honest picture. The two МРРБ regional programmes specifically are in the absorption tile above."}
        </p>
      </CardContent>
    </Card>
  );
};
