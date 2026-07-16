// Околна среда (МОСВ) sector pack — the environment-specific visuals rendered as the
// content of /sector/environment (and on the /awarder/000697371 page). Like the
// transport/МВР packs it renders the domain-unique tiles off the EXISTING corpus + the
// already-ingested air / EU-funds / budget / COFOG assets — no new procurement ingest.
//
// THESIS: GF05 „Опазване на околната среда" is the last untouched top-level COFOG
// function, and the one sector where the app already measures the OUTCOME — the air.
// So the pack puts the money next to the result: МОСВ/ИАОС/ПУДООС procurement + ОП
// „Околна среда" EU money on one side, the measured PM10/PM2.5 on the other. The
// signature finding: ИАОС — the agency that produces the PM10 series — is itself nearly
// the size of the whole ministry.
//
// UNIVERSE Select isolates a universe (ministry / agency / fund / parks / basin / riosv
// / meteo) so "what МОСВ buys" isn't only the ministry + ИАОС.

import { FC, useMemo, useState } from "react";
import { Link, useSearchParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Leaf } from "lucide-react";
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
import {
  useEnvironment,
  useEnvironmentFunds,
  type ScopeWindow,
} from "@/data/procurement/useEnvironment";
import {
  categoryLabel,
  categoryCpvDivs,
  type EnvCategory,
} from "@/lib/environmentAttributes";
import { buildPackInsights, type PackInsight } from "@/lib/packInsights";
import {
  ENV_UNIVERSES,
  IAOS_EIK,
  envUniverseLabel,
  type EnvUniverse,
} from "@/lib/environmentReferenceData";
import { VikContractorHhiTile } from "../vik/VikContractorHhiTile";
import { EnvironmentAirMapTile } from "./EnvironmentAirMapTile";
import { EnvironmentAirMoneyTile } from "./EnvironmentAirMoneyTile";
import { EnvironmentEuFundsTile } from "./EnvironmentEuFundsTile";
import { EnvironmentEuPeerTile } from "./EnvironmentEuPeerTile";
import { EnvironmentBudgetTile } from "./EnvironmentBudgetTile";
import { EnvironmentCategoryTile } from "./EnvironmentCategoryTile";
import { EnvironmentCompetitionTile } from "./EnvironmentCompetitionTile";

type UniverseFilter = EnvUniverse | "all";

export const EnvironmentPack: FC<{ eik: string; scopeWindow: ScopeWindow }> = ({
  eik,
  scopeWindow,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const [universe, setUniverse] = useState<UniverseFilter>("all");
  const { model, units, groupTotalEur, isLoading } = useEnvironment(
    eik,
    scopeWindow,
    universe,
  );
  // EU-funds absorption is a programme-period figure, not scoped to the contract window
  // or the universe filter — the two ОП „Околна среда" periods + the EEA/Norway grants.
  const { funds } = useEnvironmentFunds();

  // "Per year" divisor = the length of the SCOPE WINDOW (not the contract span).
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

  const yearAligned = useMemo(() => {
    const from = scopeWindow?.from;
    const to = scopeWindow?.to;
    if (!from && !to) return true;
    return !!from && from.endsWith("-01-01") && !!to && to.endsWith("-01-01");
  }, [scopeWindow]);
  const procValue = yearAligned ? annualProc : (model?.totalEur ?? null);

  // Drill-down links: carry the current scope (elections + pscope) onto
  // /procurement/contracts?sector=environment, plus optional overrides.
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const contractsHref = (extra?: Record<string, string>) => {
    const p = new URLSearchParams(searchParams);
    p.set("sector", "environment");
    if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/procurement/contracts?${p.toString()}`;
  };
  const anchorHref = (id: string) =>
    `${location.pathname}${location.search}#${id}`;
  const insightHref = (it: PackInsight): string | undefined => {
    if (it.kind === "peak" && it.year != null)
      return contractsHref({ pscope: `y:${it.year}` });
    if (it.kind === "category" && it.categoryId) {
      const divs = categoryCpvDivs(it.categoryId as EnvCategory);
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

  // ИАОС share of the WHOLE group (independent of the active filter) — the headline
  // caveat: the air-monitoring agency is nearly the size of the whole ministry.
  const iaosShare = useMemo(() => {
    if (universe !== "all" || groupTotalEur <= 0) return null;
    const iaos = units.find((u) => u.eik === IAOS_EIK);
    return iaos && iaos.totalEur > 0 ? iaos.totalEur / groupTotalEur : null;
  }, [universe, groupTotalEur, units]);

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
        <Leaf className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Околна среда" : "Environment"}
        </h2>
        {/* Universe segmentation — default whole group; or isolate one universe. */}
        <Select
          value={universe}
          onValueChange={(v) => setUniverse(v as UniverseFilter)}
        >
          <SelectTrigger className="ml-auto h-7 w-auto min-w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              {bg ? "Цялата група (МОСВ)" : "Whole МОСВ group"}
            </SelectItem>
            {ENV_UNIVERSES.map((u) => (
              <SelectItem key={u} value={u} className="text-xs">
                {envUniverseLabel(u, lang)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Domain-only KPIs — the generic per-EIK KPIs sit in the awarder header above. */}
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
              ? "Брой структури от групата на МОСВ с договори в обхвата. Виж списъка →"
              : "МОСВ-group units with contracts in scope. See the list →"
          }
        >
          <span className="text-2xl font-bold tabular-nums">
            {units.length}
          </span>
        </StatCard>
        {iaosShare != null && (
          <StatCard
            label={bg ? "От което ИАОС" : "Of which ИАОС"}
            to={anchorHref("air-money")}
            hint={
              bg
                ? "Дял на ИАОС (агенцията, която мери въздуха) в стойността на групата. Виж парите за въздуха →"
                : "ИАОС's (the air-monitoring agency) share of the group's value. See the money for air →"
            }
          >
            <span className="text-2xl font-bold tabular-nums">
              {Math.round(iaosShare * 100)}%
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

      {/* Outcome-first: the air we measure → money-vs-outcome → EU-peer context →
          budget → EU funds → what it buys → who wins it → competition. */}
      <PackSection id="environment-air-map">
        <EnvironmentAirMapTile />
      </PackSection>

      <PackSection id="air-money">
        <EnvironmentAirMoneyTile model={model} funds={funds} />
      </PackSection>

      <PackSection id="environment-eu-peers">
        <EnvironmentEuPeerTile />
      </PackSection>

      <PackSection id="environment-budget">
        <EnvironmentBudgetTile />
      </PackSection>

      <PackSection id="eu-funds">
        <EnvironmentEuFundsTile funds={funds} />
      </PackSection>

      <PackSection id="function">
        <EnvironmentCategoryTile
          categories={model.categories}
          totalEur={model.totalEur}
        />
      </PackSection>

      <PackSection id="environment-suppliers">
        <VikContractorHhiTile
          suppliers={model.suppliers}
          totalEur={model.totalEur}
        />
      </PackSection>

      <PackSection id="competition">
        <EnvironmentCompetitionTile units={units} />
      </PackSection>

      <p className="text-[11px] text-muted-foreground/80">
        {bg ? (
          <>
            Консолидиран изглед по {units.length} структури на системата на МОСВ
            ({formatEurCompact(groupTotalEur, lang)}) — министерството, ИАОС,
            ПУДООС, националните паркове, НИМХ, басейновите дирекции и 16-те
            РИОСВ. Поръчките са от регистъра (АОП/ЦАИС ЕОП). Горите (ИА по
            горите, под МЗХ) и ВиК са отделни сектори и не са включени. Начинът
            на възлагане и броят оферти са известни за част от договорите.
          </>
        ) : (
          <>
            Consolidated across {units.length} units of the МОСВ system (
            {formatEurCompact(groupTotalEur, lang)}) — the ministry, ИАОС,
            ПУДООС, the national parks, НИМХ, the river-basin directorates and
            the 16 РИОСВ. Procurement is from the register (АОП/ЦАИС ЕОП).
            Forestry (ИА по горите, under МЗХ) and ВиК are separate sectors and
            are not included. The procedure and bid count are known for some
            contracts only.
          </>
        )}
      </p>
    </section>
  );
};
