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
import { MapPin, Waypoints, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { StatCard } from "@/screens/dashboard/StatCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRoads, type RoadsWindow } from "@/data/procurement/useRoads";
import { formatEurCompact } from "@/lib/currency";
import { ROAD_EUR_PER_KM, eurPerKmMln } from "@/lib/roadBenchmarks";
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
import { RoadNetworkMap, type RoadMetric } from "./RoadNetworkMap";
import { WARN_CHIP_COLORS } from "../chipStyles";

const pctFmt = (v: number | undefined, lang: string) =>
  v == null
    ? "—"
    : (v * 100).toLocaleString(lang, { maximumFractionDigits: 1 }) + "%";

export const RoadsPack: FC<{ eik: string; scopeWindow: RoadsWindow }> = ({
  eik,
  scopeWindow,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const [mapMetric, setMapMetric] = useState<RoadMetric>("singleBid");
  const [focusCorridor, setFocusCorridor] = useState<string | null>(null);
  const { model, isLoading } = useRoads(eik, scopeWindow);
  // Shared €/km reference levels, formatted for the key-factors prose below.
  const { rocks, bgLo, bgHi, ro, gr } = ROAD_EUR_PER_KM;
  const km = (v: number) => eurPerKmMln(v, lang);

  // Auto-generated plain-language headlines from the model (road-specific: peak
  // year, largest corridor, captured component, clean big contractor, direct %).
  const insights = useMemo(() => {
    if (!model) return [] as { text: string; warn?: boolean }[];
    const out: { text: string; warn?: boolean }[] = [];
    const eur = (v: number) => formatEurCompact(v, lang);
    const topYear = [...model.years].sort((a, b) => b.totalEur - a.totalEur)[0];
    if (topYear)
      out.push({
        text:
          lang === "bg"
            ? `${topYear.year}: ${eur(topYear.totalEur)} — най-силна година`
            : `${topYear.year}: ${eur(topYear.totalEur)} — peak year`,
      });
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
  if (isLoading)
    return (
      <div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />
    );
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

      {/* Hero — motorway network coloured by the selected metric.
          data-og: OG-card anchor (scripts/og/capture-screens.ts). */}
      <Card data-og="roads-map">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Waypoints className="h-4 w-4" />
              {lang === "bg" ? "Магистрална мрежа" : "Motorway network"}
              {focusCorridor ? (
                <button
                  type="button"
                  onClick={() => setFocusCorridor(null)}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                >
                  {focusCorridor}
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </CardTitle>
            <Select
              value={mapMetric}
              onValueChange={(v) => setMapMetric(v as RoadMetric)}
            >
              <SelectTrigger className="h-8 w-auto text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="singleBid">
                  {lang === "bg" ? "Една оферта" : "Single bidder"}
                </SelectItem>
                <SelectItem value="perKm">
                  {lang === "bg" ? "Цена на километър" : "Cost per kilometre"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-3 md:p-4">
          <RoadNetworkMap
            corridors={model.corridors}
            metric={mapMetric}
            focusCorridor={focusCorridor}
            onFocusCorridor={setFocusCorridor}
          />
          <p className="text-[11px] text-muted-foreground/80 mt-2">
            {lang === "bg"
              ? "Автомагистрали и финансирани републикански пътища (I и II клас). Дебелината на линията показва вложените средства. Кликни коридор, за да го откроиш на картата."
              : "Motorways and funded republican roads (class I and II). Line thickness reflects € spent. Click a corridor to highlight it on the map."}
          </p>
        </CardContent>
      </Card>

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

      {/* Key factors explainer (static context) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {lang === "bg"
              ? "Какво влияе на цената на километър"
              : "What drives cost per kilometre"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 md:p-4 text-sm text-muted-foreground">
          {lang === "bg" ? (
            <>
              <p>
                Цената на километър не е сравнима между различни видове работа и
                терен. Ново строителство на автомагистрала, основен ремонт на
                път III клас и съоръжения (мостове, тунели) се различават
                многократно — тунелните участъци достигат десетки милиони на
                километър. Затова сравняваме всеки участък спрямо вътрешен
                еталон за същия клас път и вид работа, а не директно с други
                държави.
              </p>
              <p className="mt-2 text-xs">
                За груб ориентир (не пряко сравнение): ново строителство на
                магистрала в България е средно около €{km(bgLo)}–{km(bgHi)}{" "}
                млн/км, в Румъния ~€{km(ro)} млн/км, в Гърция ~€{km(gr)} млн/км;
                базата на Световната банка (ROCKS) дава ~€{km(rocks)} млн/км за
                двулентов път без съоръжения.
              </p>
            </>
          ) : (
            <>
              <p>
                Cost per kilometre is not comparable across work types or
                terrain. New motorway construction, major rehabilitation of a
                class III road and structures (bridges, tunnels) differ by an
                order of magnitude — tunnel sections reach tens of millions per
                kilometre. Each segment is therefore benchmarked against an
                internal reference class for the same road class and work type,
                not directly against other countries.
              </p>
              <p className="mt-2 text-xs">
                As a rough, non-comparable benchmark: new motorway construction
                averages ~€{km(bgLo)}–{km(bgHi)}M/km in Bulgaria, ~€{km(ro)}M/km
                in Romania, ~€{km(gr)}M/km in Greece; the World Bank ROCKS
                database gives ~€{km(rocks)}M/km for a two-lane road excluding
                structures.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground/80">
        {lang === "bg"
          ? "Пътните референции и дължини са разчетени от заглавията на договорите."
          : "Road references and lengths parsed from contract titles."}
      </p>
    </section>
  );
};
