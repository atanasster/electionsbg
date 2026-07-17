// „Европейски средства (ИСУН) по област" — the per-oblast money map. Where does the EU
// money land, per oblast, in total and per resident. Reuses the shared OblastChoropleth
// (Sofia-merged geometry, percentile colour, tooltip). A total⇄per-capita toggle switches
// the metric. This is the „Kohesio for BG" tile — our ИСУН corpus surfaced per oblast (§2).
//
// ⚠ ALL ИСУН funds (every OP + the RRF), not just the two МРРБ regional OPs — those
// specifically are in the cohesion burn-down tile above.
//
// ATTRIBUTION: each contract is pinned to its DECLARED place of implementation
// (ИСУН's „Местонахождение", resolved in scripts/funds/projects_resolve.ts), not to the
// beneficiary's seat. Contracts whose scope is national/regional or unresolved are not
// apportioned to any oblast at all — projects_ingest.ts routes them to multi_location.json,
// so they never reach this map. An earlier version of this caption claimed the opposite
// ("attributed to the beneficiary, so Sofia is inflated by nationally-run programmes
// headquartered there"); that was wrong on both the mechanism and the effect. Measured
// 2026-07-17 against fund_payloads: Sofia city takes 20.2% of the €29.0bn corpus while
// holding ~19% of the population, and ranks 15th of 28 oblasts per resident (€4,593) —
// mid-pack, not an outlier. Default to the per-capita view, which is the honest cut.

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
            ? "Договорени европейски средства (всички фондове по ИСУН, вкл. ПВУ), обобщени по област от общинско ниво. Всеки проект е отнесен към декларираното място на изпълнение. Проектите с национален или регионален обхват не могат да се отнесат към област и не влизат в картата — това са само 4,6% от договорите, но около половината пари, така че картата показва разпределимата половина. Двете регионални програми на МРРБ поотделно са в усвояването по-горе."
            : "Contracted EU funds (all ИСУН funds incl. the RRF), aggregated to oblast from the municipal level. Each project is attributed to its declared place of implementation. Nationally- and regionally-scoped projects cannot be assigned to an oblast and are excluded — just 4.6% of contracts but roughly half the money, so this map shows the apportionable half. The two МРРБ regional programmes specifically are in the absorption tile above."}
        </p>
      </CardContent>
    </Card>
  );
};
