// Транспорт sector pack — the transport-specific procurement visuals, rendered as the
// content of /sector/transport (and on the /awarder/000695388 page). Like the
// defense/МВР/water packs it renders the domain-unique tiles off the EXISTING corpus —
// no new ingest: spend by mode, the ministry-budget context, what-transport-buys by
// function, contractor HHI, per-unit competition, and the biggest contracts. Mirrors
// MvrPack.
//
// THESIS: the state transport group spends ~€5.9bn through the corpus, and the money
// concentrates in RAIL (НКЖИ + БДЖ) and EU-funded construction. Roads (АПИ) are a
// SEPARATE sector — excluded here, cross-linked, so the two don't double-count.
//
// NOTE: rail dominates; the universe Select lets the reader isolate a mode (rail /
// maritime / aviation / road / ministry) so "what transport buys" isn't only trains.

import { FC, useMemo, useState } from "react";
import { Link, useSearchParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TrainFront } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";
import { PackSelect } from "../PackSelect";
import { WARN_CHIP_COLORS } from "../chipStyles";
import { PackSection } from "../PackSection";
import { useHashScroll } from "@/ux/useHashScroll";
import {
  useTransport,
  useTransportFunds,
  type ScopeWindow,
} from "@/data/procurement/useTransport";
import {
  categoryLabel,
  categoryCpvDivs,
  type TransportCategory,
} from "@/lib/transportAttributes";
import { buildPackInsights, type PackInsight } from "@/lib/packInsights";
import {
  TRANSPORT_UNIVERSES,
  TRANSPORT_SECTOR_EIKS,
  transportUniverseLabel,
  type TransportUniverse,
} from "@/lib/transportReferenceData";
import { VikContractorHhiTile } from "../vik/VikContractorHhiTile";
import { TransportProjectMap } from "./TransportProjectMap";
import { TransportModeSplitTile } from "./TransportModeSplitTile";
import { TransportEuPeerTile } from "./TransportEuPeerTile";
import { TransportBudgetTile } from "./TransportBudgetTile";
import { TransportSubsidyTile } from "./TransportSubsidyTile";
import { TransportEuFundsTile } from "./TransportEuFundsTile";
import { TransportCategoryTile } from "./TransportCategoryTile";
import { TransportCompetitionTile } from "./TransportCompetitionTile";
import { TransportTopContractsTile } from "./TransportTopContractsTile";
import { TransportRoadSafetyTile } from "./TransportRoadSafetyTile";
import { TransportRoadsLinkTile } from "./TransportRoadsLinkTile";

type UniverseFilter = TransportUniverse | "all";

export const TransportPack: FC<{ eik: string; scopeWindow: ScopeWindow }> = ({
  eik,
  scopeWindow,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const [universe, setUniverse] = useState<UniverseFilter>("all");
  const { model, units, groupTotalEur, isLoading } = useTransport(
    eik,
    scopeWindow,
    universe,
  );
  // EU-funds absorption is a programme-period, whole-group figure (not scoped to the
  // contract window or the mode filter) — always over the full transport EIK set.
  const { funds } = useTransportFunds(TRANSPORT_SECTOR_EIKS);

  // "Per year" divisor = the length of the SCOPE WINDOW (not the contract span), so an
  // edge gap year doesn't inflate the average — same rule as the МВР/defense packs.
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

  // Whole number of full calendar years (or "all") → the headline KPI is a per-year
  // figure. Otherwise a partial window (current parliament) → show the period TOTAL,
  // labelled "за периода" (annualising a partial window misleads).
  const yearAligned = useMemo(() => {
    const from = scopeWindow?.from;
    const to = scopeWindow?.to;
    if (!from && !to) return true;
    return !!from && from.endsWith("-01-01") && !!to && to.endsWith("-01-01");
  }, [scopeWindow]);
  const procValue = yearAligned ? annualProc : (model?.totalEur ?? null);

  // Human label for the active scope's year span — passed to the facility map so a
  // sparse partial-period map reads as "the selected period", not "broken".
  const periodLabel = useMemo(() => {
    if (!procSpan) return null;
    return procSpan.from === procSpan.to
      ? String(procSpan.from)
      : `${procSpan.from}–${procSpan.to}`;
  }, [procSpan]);

  // Drill-down links: contractsHref carries the current scope (elections + pscope)
  // onto /procurement/contracts?sector=transport, plus optional overrides.
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const contractsHref = (extra?: Record<string, string>) => {
    const p = new URLSearchParams(searchParams);
    p.set("sector", "transport");
    if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/procurement/contracts?${p.toString()}`;
  };
  const anchorHref = (id: string) =>
    `${location.pathname}${location.search}#${id}`;
  const insightHref = (it: PackInsight): string | undefined => {
    if (it.kind === "peak" && it.year != null)
      return contractsHref({ pscope: `y:${it.year}` });
    if (it.kind === "category" && it.categoryId) {
      const divs = categoryCpvDivs(it.categoryId as TransportCategory);
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

  // Rail share of the WHOLE group (independent of the active filter) — the headline
  // caveat: НКЖИ + БДЖ dominate, so the reader knows rail carries the group before
  // reading the mode split.
  const railShare = useMemo(() => {
    if (universe !== "all" || groupTotalEur <= 0) return null;
    const rail = units
      .filter((u) => u.universe === "rail")
      .reduce((a, u) => a + u.totalEur, 0);
    return rail > 0 ? rail / groupTotalEur : null;
  }, [universe, groupTotalEur, units]);

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
        <TrainFront className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Транспорт" : "Transport"}
        </h2>
        {/* Mode segmentation — default whole group; or isolate a single mode. */}
        <PackSelect
          value={universe}
          onChange={setUniverse}
          ariaLabel={bg ? "Избор на структури" : "Select units"}
          className="ml-auto"
          options={[
            {
              value: "all" as UniverseFilter,
              label: bg ? "Целият транспорт" : "Whole transport group",
            },
            ...TRANSPORT_UNIVERSES.map((u) => ({
              value: u as UniverseFilter,
              label: transportUniverseLabel(u, lang),
            })),
          ]}
        />
      </div>

      {/* Domain-only KPIs — the generic per-EIK total/contracts/suppliers KPIs sit in
          the awarder header above; keep only the group-only figures. */}
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
              ? "Брой структури в транспортната група с договори в обхвата. Виж списъка →"
              : "Transport-group units with contracts in scope. See the list →"
          }
        >
          <span className="text-2xl font-bold tabular-nums">
            {units.length}
          </span>
        </StatCard>
        {railShare != null && (
          <StatCard
            label={bg ? "От което железници" : "Of which railways"}
            to={anchorHref("mode-split")}
            hint={
              bg
                ? "Дял на железниците (НКЖИ + БДЖ) в стойността на групата. Виж разбивката по вид →"
                : "Railways' (НКЖИ + БДЖ) share of the group's value. See the mode split →"
            }
          >
            <span className="text-2xl font-bold tabular-nums">
              {Math.round(railShare * 100)}%
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

      {/* Money-first bands: by mode (the signature) → the ministry budget & rail
          subsidy → what it buys → biggest contracts → who wins it → competition →
          the roads cross-link. Each tile carries its own titled header, so the band
          is a bare rule + anchor (no doubled heading). */}
      <PackSection id="transport-map">
        <TransportProjectMap
          eik={eik}
          scopeWindow={scopeWindow}
          periodLabel={periodLabel}
        />
      </PackSection>

      <PackSection id="transport-mode">
        <TransportModeSplitTile units={units} />
      </PackSection>

      <PackSection id="transport-eu-peers">
        <TransportEuPeerTile />
      </PackSection>

      <PackSection id="transport-budget">
        <TransportBudgetTile />
      </PackSection>

      <PackSection id="transport-rail-subsidy">
        <TransportSubsidyTile />
      </PackSection>

      <PackSection id="transport-eu-funds">
        <TransportEuFundsTile funds={funds} />
      </PackSection>

      <PackSection id="transport-category">
        <TransportCategoryTile
          categories={model.categories}
          totalEur={model.totalEur}
        />
      </PackSection>

      <PackSection id="transport-top-contracts">
        <TransportTopContractsTile />
      </PackSection>

      <PackSection id="transport-suppliers">
        <VikContractorHhiTile
          suppliers={model.suppliers}
          totalEur={model.totalEur}
        />
      </PackSection>

      <PackSection id="transport-competition">
        <TransportCompetitionTile units={units} />
      </PackSection>

      <PackSection id="transport-road-safety">
        <TransportRoadSafetyTile />
      </PackSection>

      <PackSection id="transport-roads">
        <TransportRoadsLinkTile />
      </PackSection>

      <p className="text-[11px] text-muted-foreground/80">
        {bg ? (
          <>
            Консолидиран изглед по {units.length} структури на държавния
            транспорт ({formatEurCompact(groupTotalEur, lang)}); заглавната
            карта горе показва само централното МТС. Поръчките са от регистъра
            (АОП/ЦАИС ЕОП). Пътната инфраструктура (АПИ) е отделен сектор и не е
            включена. Начинът на възлагане липсва за част от договорите, а броят
            оферти е известен за част от тях — затова делът „с една оферта“ е
            сред договорите с известни оферти.
          </>
        ) : (
          <>
            Consolidated across {units.length} state-transport units (
            {formatEurCompact(groupTotalEur, lang)}); the header card above
            shows only the central МТС. Procurement is from the register
            (АОП/ЦАИС ЕОП). Road infrastructure (АПИ) is a separate sector and
            is not included. The procedure is missing for some contracts and the
            bid count is known for some, so the “single-bid” share is of
            bid-known contracts only.
          </>
        )}
      </p>
    </section>
  );
};
