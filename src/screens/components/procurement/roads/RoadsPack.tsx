// Roads sector pack — the АПИ-specific procurement visuals, rendered inside the
// generic awarder dashboard (/awarder/000695089). This is the "keep the focus
// on roads" layer: the motorway network map, construction-category split,
// cost-per-km, work components and the tender pipeline, all computed client-side
// from the per-contract rows by the roadAttributes engine.
//
// It deliberately renders ONLY the road-unique tiles — the generic buy-side
// tiles (KPIs, top contracts/contractors, "Какво купува", money-flow, treemap,
// by-year) already live on the awarder page above it, so nothing is duplicated.
//
// Scope is inherited from the host: the awarder page's scope control drives a
// [from, to) window that is passed straight through to useRoads, so the whole
// page (generic + roads) re-scopes together.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPin, Waypoints } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { useRoads, type ScopeWindow } from "@/data/procurement/useRoads";
import { formatEurCompact } from "@/lib/currency";
import { RoadCostPerKmTile } from "./RoadCostPerKmTile";
import { RoadWorkGroupDonut } from "./RoadWorkGroupDonut";
import { RoadComponentsTile } from "./RoadComponentsTile";
import { COMPONENT_LABEL } from "./roadLabels";
import { RoadTimeSpineTile } from "./RoadTimeSpineTile";
import { RoadPlannedTendersTile } from "./RoadPlannedTendersTile";
import { RoadRegionCompetitionTile } from "./RoadRegionCompetitionTile";
import { RoadRepeatWinnersTile } from "./RoadRepeatWinnersTile";
import { RoadCostBenchmarkTile } from "./RoadCostBenchmarkTile";
import { RoadChainageStripTile } from "./RoadChainageStripTile";
import { RoadNetworkCard } from "./RoadNetworkCard";
import { RoadCostExplainer } from "./RoadCostExplainer";
import { WARN_CHIP_COLORS } from "../chipStyles";
import { ChartGhost } from "@/ux/motion/ChartGhost";

const pctFmt = (v: number | undefined, lang: string) =>
  v == null
    ? "—"
    : (v * 100).toLocaleString(lang, { maximumFractionDigits: 1 }) + "%";

export const RoadsPack: FC<{ eik: string; scopeWindow: ScopeWindow }> = ({
  eik,
  scopeWindow,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const [focusCorridor, setFocusCorridor] = useState<string | null>(null);
  const { model, isLoading } = useRoads(eik, scopeWindow);

  // Auto-generated plain-language headlines from the model (road-specific: peak
  // year, largest corridor, captured component, clean big contractor, direct %).
  const insights = useMemo(() => {
    if (!model) return [] as { text: string; warn?: boolean }[];
    const out: { text: string; warn?: boolean }[] = [];
    const eur = (v: number) => formatEurCompact(v, lang);
    const topYear = [...model.years].sort((a, b) => b.totalEur - a.totalEur)[0];
    // "Peak year" is only meaningful when there are several years to rank; a
    // single-year scope shows just that year's total without the superlative.
    if (topYear) {
      const suffix =
        model.years.length > 1
          ? lang === "bg"
            ? " — най-силна година"
            : " — peak year"
          : "";
      // Current value after annexes, booked to the signing year (D6) — say so,
      // or a peak that is ~⅓ options exercised later reads as new awards.
      const basis = lang === "bg" ? " (след анекси)" : " (after annexes)";
      out.push({
        text: `${topYear.year}: ${eur(topYear.totalEur)}${basis}${suffix}`,
      });
    }
    const topCor = model.corridors[0];
    if (topCor)
      out.push({
        text:
          lang === "bg"
            ? `${topCor.corridor}: ${eur(topCor.totalEur)} — най-голям коридор`
            : `${topCor.corridor}: ${eur(topCor.totalEur)} — largest corridor`,
      });
    const cap = [...model.components]
      .filter((c) => c.contractCount >= 3 && (c.singleBidShare ?? 0) >= 0.8)
      .sort((a, b) => (b.singleBidShare ?? 0) - (a.singleBidShare ?? 0))[0];
    if (cap)
      out.push({
        warn: true,
        text: `${lang === "bg" ? COMPONENT_LABEL[cap.component].bg : COMPONENT_LABEL[cap.component].en}: ${Math.round((cap.singleBidShare ?? 0) * 100)}% ${lang === "bg" ? "една оферта" : "single-bid"}`,
      });
    const comp = model.topContractors.find(
      (c) => (c.singleBidShare ?? 1) === 0 && c.totalEur > 5e7,
    );
    if (comp)
      out.push({
        text: `${comp.name.split(/\s[-–—]\s|,/)[0].trim()}: ${eur(comp.totalEur)} ${lang === "bg" ? "при 0% една оферта" : "at 0% single-bid"}`,
      });
    if (model.directShare > 0.05)
      out.push({
        warn: model.directShare > 0.1,
        text: `${Math.round(model.directShare * 100)}% ${lang === "bg" ? "без търг" : "direct award"}`,
      });
    return out.slice(0, 5);
  }, [model, lang]);

  // Loading / empty — the host already renders its awarder header + KPIs, so a
  // quiet skeleton (or nothing) keeps the page coherent while the corpus loads.
  if (isLoading) return <ChartGhost className="my-4 h-[280px]" />;
  if (!model || model.totalEur === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pt-2">
        <Waypoints className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {lang === "bg" ? "Пътна инфраструктура" : "Road infrastructure"}
        </h2>
      </div>

      {/* Road-specific coverage KPI. The generic total/contracts/suppliers KPIs
          sit in the awarder header above, and single-bid % / no-call % now render
          in the shared EU-benchmarks tile — so the pack keeps only the metric
          that is genuinely roads-only. */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={lang === "bg" ? "На разпознат път" : "On a named road"}
          hint={
            lang === "bg"
              ? "Дял от обема по договори с разпознаваема пътна референция (АМ или Път I/II/III)."
              : "Share of volume on contracts with a recognisable road reference."
          }
        >
          <div className="flex items-baseline gap-2">
            <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="text-2xl font-bold tabular-nums">
              {pctFmt(model.refCoverageEur, lang)}
            </span>
          </div>
        </StatCard>
      </div>

      {/* Insight chips — auto headlines */}
      {insights.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {insights.map((it, i) => (
            <span
              key={i}
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                it.warn
                  ? WARN_CHIP_COLORS
                  : "border-border bg-muted/40 text-foreground"
              }`}
            >
              {it.text}
            </span>
          ))}
        </div>
      ) : null}

      {/* Hero — motorway network coloured by the selected metric. */}
      <RoadNetworkCard
        corridors={model.corridors}
        focusCorridor={focusCorridor}
        onFocusCorridor={setFocusCorridor}
      />

      {/* Where the money landed along each motorway (km axis, spend density) */}
      <RoadChainageStripTile rows={model.rows} />

      {/* Spending over time — stacked by construction category / corridor */}
      <RoadTimeSpineTile years={model.years} />

      {/* Cost/km + construction-category split (build vs repair vs maintenance) */}
      <div className="grid gap-4 xl:grid-cols-2">
        <RoadCostPerKmTile corridors={model.corridors} />
        <RoadWorkGroupDonut
          groups={model.workGroups}
          totalEur={model.totalEur}
        />
      </div>

      {/* €/km against international reference levels (ROCKS / BG / RO / GR) */}
      <RoadCostBenchmarkTile corridors={model.corridors} />

      {/* Kinds of work (tunnels, bridges, markings…) with capture metrics */}
      <RoadComponentsTile components={model.components} />

      {/* Where competition collapses — ОПУ single-bid heatmap + corridor capture */}
      <div className="grid gap-4 xl:grid-cols-2">
        <RoadRegionCompetitionTile regions={model.regions} />
        <RoadRepeatWinnersTile rows={model.rows} />
      </div>

      {/* Planned procurements (tender pipeline — what is announced to be built) */}
      <RoadPlannedTendersTile />

      <RoadCostExplainer />

      <p className="text-[11px] text-muted-foreground/80">
        {lang === "bg"
          ? "Пътните референции и дължини са разчетени от заглавията на договорите."
          : "Road references and lengths parsed from contract titles."}
      </p>
    </section>
  );
};
