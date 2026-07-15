// Полиция / МВР sector pack — the МВР-specific procurement visuals, rendered as
// the content of /sector/security (and on the /awarder/000695235 page). Like the
// defense/roads/НЗОК packs it renders the domain-unique tiles off the EXISTING
// corpus — no new ingest: the iceberg budget bridge, consolidated group roll-up,
// what-МВР-buys by function, contractor HHI, per-unit competition heatmap, and the
// security-exemption transparency gap. Mirrors DefensePack.
//
// THESIS (the iceberg): МВР spends ~€2.1bn/yr but ~90% is payroll and a slice is
// security-exempt — the visible open-procurement corpus (~€1.9bn cumulative) is a
// fraction of one year's budget. So the pack is contract-led AND names the gap.
//
// NOTE: the Медицински институт (health) buys drugs; the universe Select lets the
// reader drop it / isolate a universe so "what МВР buys" isn't medicines.

import { FC, useMemo, useState } from "react";
import { Link, useSearchParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Shield, Activity } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WARN_CHIP_COLORS } from "../chipStyles";
import { PackSection } from "../PackSection";
import { useHashScroll } from "@/ux/useHashScroll";
import { useMvr, type ScopeWindow } from "@/data/procurement/useMvr";
import {
  categoryLabel,
  categoryCpvDivs,
  type SecurityCategory,
} from "@/lib/securityAttributes";
import { buildPackInsights, type PackInsight } from "@/lib/packInsights";
import {
  SECURITY_UNIVERSES,
  securityUniverseLabel,
  MEDICAL_INSTITUTE_EIK,
  type SecurityUniverse,
} from "@/lib/securityReferenceData";
import { VikContractorHhiTile } from "../vik/VikContractorHhiTile";
import { MvrBudgetBridgeTile } from "./MvrBudgetBridgeTile";
import { MvrCategoryTile } from "./MvrCategoryTile";
import { MvrCompetitionTile } from "./MvrCompetitionTile";
import { MvrTopContractsTile } from "./MvrTopContractsTile";
import { MvrOblastMapTile } from "./MvrOblastMapTile";
import { MvrRoadSafetyTile } from "./MvrRoadSafetyTile";
import { MvrCrimeScatterTile } from "./MvrCrimeScatterTile";
import { MvrTransparencyTile } from "./MvrTransparencyTile";

type UniverseFilter = SecurityUniverse | "all" | "no_health";

export const MvrPack: FC<{ eik: string; scopeWindow: ScopeWindow }> = ({
  eik,
  scopeWindow,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const [universe, setUniverse] = useState<UniverseFilter>("all");
  const { model, units, groupTotalEur, isLoading } = useMvr(
    eik,
    scopeWindow,
    universe,
  );

  // "Per year" divisor = the length of the SCOPE WINDOW (not the contract span),
  // so an edge gap year doesn't inflate the average — same rule as the defense pack.
  const procSpan = useMemo(() => {
    const from = scopeWindow?.from;
    const to = scopeWindow?.to;
    if (from && to) {
      const last = new Date(to);
      last.setUTCDate(last.getUTCDate() - 1);
      const y0 = new Date(from).getUTCFullYear();
      const y1 = last.getUTCFullYear();
      if (Number.isFinite(y0) && Number.isFinite(y1) && y1 >= y0)
        return { from: y0, to: y1, years: y1 - y0 + 1 };
    }
    if (!model || model.minYear == null || model.maxYear == null) return null;
    return {
      from: model.minYear,
      to: model.maxYear,
      years: model.maxYear - model.minYear + 1,
    };
  }, [scopeWindow, model]);
  const procYears = procSpan?.years ?? null;
  const annualProc = useMemo(() => {
    if (!model || !procYears || procYears <= 0) return null;
    return model.totalEur / procYears;
  }, [model, procYears]);

  // Is the scope a whole number of full calendar years (Jan-1→Jan-1, or "all")?
  // Then the headline KPI is a per-year figure. Otherwise it's a partial window
  // (e.g. the current parliament, starting on an election date) and annualising it
  // is misleading — show the period TOTAL, labelled "за периода".
  const yearAligned = useMemo(() => {
    const from = scopeWindow?.from;
    const to = scopeWindow?.to;
    if (!from && !to) return true;
    return !!from && from.endsWith("-01-01") && !!to && to.endsWith("-01-01");
  }, [scopeWindow]);
  const procValue = yearAligned ? annualProc : (model?.totalEur ?? null);

  // Human label for the active scope's year span — passed to the scoped per-oblast
  // tiles so a sparse partial-period map reads as "the selected period", not "broken".
  const periodLabel = useMemo(() => {
    if (!procSpan) return null;
    return procSpan.from === procSpan.to
      ? String(procSpan.from)
      : `${procSpan.from}–${procSpan.to}`;
  }, [procSpan]);

  // Drill-down links. contractsHref carries the current scope (elections + pscope)
  // onto /procurement/contracts?sector=security, plus optional overrides (cpv /
  // pscope). Same-page anchors keep the current URL.
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const contractsHref = (extra?: Record<string, string>) => {
    const p = new URLSearchParams(searchParams);
    p.set("sector", "security");
    if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/procurement/contracts?${p.toString()}`;
  };
  const anchorHref = (id: string) =>
    `${location.pathname}${location.search}#${id}`;
  const insightHref = (it: PackInsight): string | undefined => {
    if (it.kind === "peak" && it.year != null)
      return contractsHref({ pscope: `y:${it.year}` });
    if (it.kind === "category" && it.categoryId) {
      const divs = categoryCpvDivs(it.categoryId as SecurityCategory);
      return divs.length
        ? contractsHref({ cpv: divs.join(",") })
        : anchorHref("function");
    }
    if (it.kind === "direct") return anchorHref("competition");
    return undefined;
  };

  const insights = useMemo(
    () => buildPackInsights(model, categoryLabel, lang),
    [model, lang],
  );

  // Медицински институт share of the WHOLE group (independent of the active
  // filter) — the headline caveat, so the reader knows military-style health
  // procurement is folded in before they read the split.
  const healthShare = useMemo(() => {
    if (universe !== "all" || groupTotalEur <= 0) return null;
    const med = units.find((u) => u.eik === MEDICAL_INSTITUTE_EIK);
    return med ? med.totalEur / groupTotalEur : null;
  }, [universe, groupTotalEur, units]);

  // Vehicle-category € (CPV 34) — the traffic-police instrument, for the road-
  // safety outcome pairing. Whole-group figure in the active scope/universe.
  const vehicleEur = useMemo(
    () => model?.categories.find((c) => c.id === "vehicles")?.totalEur ?? 0,
    [model],
  );

  // Deep-link anchors settle as the model arrives; re-fire the scroll then.
  useHashScroll([model, units, isLoading]);

  if (isLoading)
    return (
      <div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />
    );
  const hasModel = !!model && model.totalEur > 0;
  if (!hasModel) return null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-2">
        <Shield className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Сигурност / МВР" : "Security / МВР"}
        </h2>
        {/* Universe segmentation — default "цялата МВР група"; "без Мед. институт"
            / a single universe. */}
        <Select
          value={universe}
          onValueChange={(v) => setUniverse(v as UniverseFilter)}
        >
          <SelectTrigger className="ml-auto h-7 w-auto min-w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              {bg ? "Цялата МВР група" : "Whole МВР group"}
            </SelectItem>
            <SelectItem value="no_health" className="text-xs">
              {bg ? "Без Мед. институт" : "Excluding Medical Institute"}
            </SelectItem>
            {SECURITY_UNIVERSES.map((u) => (
              <SelectItem key={u} value={u} className="text-xs">
                {securityUniverseLabel(u, lang)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Domain-only KPIs — the generic per-EIK total/contracts/suppliers KPIs sit
          in the awarder header above; keep only the group-only figures. */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={
            yearAligned
              ? bg
                ? "Поръчки на година"
                : "Procurement per year"
              : bg
                ? "Поръчки за периода"
                : "Procurement in period"
          }
          to={contractsHref()}
          hint={
            yearAligned
              ? bg
                ? `Договорена стойност, усреднена за обхвата${procSpan ? ` (${procSpan.from}–${procSpan.to})` : ""}. Виж договорите →`
                : `Contracted value, averaged over the scope${procSpan ? ` (${procSpan.from}–${procSpan.to})` : ""}. See the contracts →`
              : bg
                ? "Обща договорена стойност за избрания период. Виж договорите →"
                : "Total contracted value for the selected period. See the contracts →"
          }
        >
          <span className="text-2xl font-bold tabular-nums">
            {procValue != null ? formatEurCompact(procValue, lang) : "—"}
          </span>
        </StatCard>
        <StatCard
          label={bg ? "Структури с договори" : "Units with contracts"}
          to={anchorHref("competition")}
          hint={
            bg
              ? "Брой структури на МВР с договори в обхвата. Виж списъка →"
              : "МВР budget units with contracts in scope. See the list →"
          }
        >
          <span className="text-2xl font-bold tabular-nums">
            {units.length}
          </span>
        </StatCard>
        {healthShare != null && (
          <StatCard
            label={bg ? "От което Мед. институт" : "Of which Medical Institute"}
            to={`/awarder/${MEDICAL_INSTITUTE_EIK}`}
            hint={
              bg
                ? "Дял на болничното здравеопазване (лекарства, консумативи) в стойността на групата. Използвайте филтъра „без Мед. институт“. Виж институцията →"
                : "Hospital-health (drugs, consumables) share of the group's value. Use the “excluding Medical Institute” filter. See the institution →"
            }
          >
            <span className="text-2xl font-bold tabular-nums">
              {Math.round(healthShare * 100)}%
            </span>
          </StatCard>
        )}
      </div>

      {insights.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {insights.map((it, i) => {
            const href = insightHref(it);
            const cls = `inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
              it.warn
                ? WARN_CHIP_COLORS
                : "border-border bg-muted/40 text-foreground"
            }`;
            return href ? (
              <Link
                key={i}
                to={href}
                className={`${cls} transition-colors hover:border-primary/50 hover:bg-primary/5`}
              >
                {it.text}
              </Link>
            ) : (
              <span key={i} className={cls}>
                {it.text}
              </span>
            );
          })}
        </div>
      )}

      {/* Money-first bands: the iceberg → what МВР buys → who wins it →
          competition → outcomes → transparency. Each tile carries its own titled
          header, so the band is a bare rule + anchor (no doubled heading). The
          multi-tile "Outcomes" band keeps a group heading. */}
      <PackSection id="mvr-budget">
        <MvrBudgetBridgeTile procEur={procValue} perYear={yearAligned} />
      </PackSection>

      <PackSection id="mvr-category">
        <MvrCategoryTile
          categories={model.categories}
          totalEur={model.totalEur}
        />
      </PackSection>

      <PackSection id="mvr-top-contracts">
        <MvrTopContractsTile />
      </PackSection>

      <PackSection id="mvr-suppliers">
        <VikContractorHhiTile
          suppliers={model.suppliers}
          totalEur={model.totalEur}
        />
      </PackSection>

      <PackSection id="mvr-competition">
        <MvrCompetitionTile units={units} />
      </PackSection>

      <PackSection id="mvr-oblast">
        <MvrOblastMapTile units={units} periodLabel={periodLabel} />
      </PackSection>

      <PackSection
        icon={Activity}
        id="mvr-outcomes"
        title={bg ? "Резултати" : "Outcomes"}
        sub={
          bg
            ? "Разходът срещу това, което трябва да постигне — контекст, не причинно-следствена връзка."
            : "The spending against what it is meant to achieve — context, not causation."
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <MvrRoadSafetyTile vehicleEur={vehicleEur} />
          <MvrCrimeScatterTile units={units} />
        </div>
      </PackSection>

      <PackSection id="mvr-transparency">
        <MvrTransparencyTile groupTotalEur={groupTotalEur} />
      </PackSection>

      <p className="text-[11px] text-muted-foreground/80">
        {bg ? (
          <>
            Консолидиран изглед по 74 структури на Министерството на вътрешните
            работи ({formatEurCompact(groupTotalEur, lang)}); заглавната карта
            горе показва само централното МВР. Поръчките са от регистъра
            (АОП/ЦАИС ЕОП); класифицираните доставки за сигурност не са в него
            (виж „Какво се вижда и какво — не“ по-долу). Начинът на възлагане
            липсва за част от договорите, а броят оферти е известен за част от
            тях — затова делът „с една оферта“ е сред договорите с известни
            оферти.
          </>
        ) : (
          <>
            Consolidated across 74 Ministry of Interior units (
            {formatEurCompact(groupTotalEur, lang)}); the header card above
            shows only the central МВР. Procurement is from the register
            (АОП/ЦАИС ЕОП); classified security buys are not in it (see “What is
            visible, and what is not” below). The procedure is missing for some
            contracts and the bid count is known for some, so the “single-bid”
            share is of bid-known contracts only.
          </>
        )}
      </p>
    </section>
  );
};
