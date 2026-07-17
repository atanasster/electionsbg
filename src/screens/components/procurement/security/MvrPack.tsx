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
import { useAwarderHref } from "../useAwarderHref";
import { useTranslation } from "react-i18next";
import { Shield, Activity, Users } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";
import { PackSelect } from "../PackSelect";
import { WARN_CHIP_COLORS } from "../chipStyles";
import { PackSection } from "../PackSection";
import { PackFootnote } from "../PackFootnote";
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
import { MvrPersonnelTile } from "./MvrPersonnelTile";
import { MvrEuPeerTile } from "./MvrEuPeerTile";
import { MvrCategoryTile } from "./MvrCategoryTile";
import { MvrCompetitionTile } from "./MvrCompetitionTile";
import { MvrTopContractsTile } from "./MvrTopContractsTile";
import { MvrOblastMapTile } from "./MvrOblastMapTile";
import { MvrDirectorateMap } from "./MvrDirectorateMap";
import { MvrRoadSafetyTile } from "./MvrRoadSafetyTile";
import { MvrCrimeScatterTile } from "./MvrCrimeScatterTile";
import { MvrTransparencyTile } from "./MvrTransparencyTile";

type UniverseFilter = SecurityUniverse | "all" | "no_health";

export const MvrPack: FC<{ eik: string; scopeWindow: ScopeWindow }> = ({
  eik,
  scopeWindow,
}) => {
  const { i18n } = useTranslation();
  // Carry the active scope onto the awarder page (see SectorAwardersTile).
  const awarderHref = useAwarderHref();
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
      {/* Signature visual — where the МВР structures sit, city by city. Mounted at
          the top of the pack (the house convention for sector maps, cf. NzokPack).
          Self-fetches its own scope-aware geo blob and self-hides until it loads. */}
      <div id="mvr-map" className="scroll-mt-24">
        <MvrDirectorateMap
          eik={eik}
          scopeWindow={scopeWindow}
          periodLabel={periodLabel}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-2">
        <Shield className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Сигурност / МВР" : "Security / МВР"}
        </h2>
        {/* Universe segmentation — default "цялата МВР група"; "без Мед. институт"
            / a single universe. */}
        <PackSelect
          value={universe}
          onChange={setUniverse}
          ariaLabel={bg ? "Избор на структури" : "Select units"}
          className="ml-auto"
          options={[
            {
              value: "all" as UniverseFilter,
              label: bg ? "Цялата МВР група" : "Whole МВР group",
            },
            {
              value: "no_health" as UniverseFilter,
              label: bg ? "Без Мед. институт" : "Excluding Medical Institute",
            },
            ...SECURITY_UNIVERSES.map((u) => ({
              value: u as UniverseFilter,
              label: securityUniverseLabel(u, lang),
            })),
          ]}
        />
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
            to={awarderHref(MEDICAL_INSTITUTE_EIK)}
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

      <PackSection
        icon={Users}
        id="mvr-personnel"
        title={bg ? "Персонал и сравнение с ЕС" : "Personnel & EU comparison"}
        sub={
          bg
            ? "МВР е ~90% заплати — колко струва един служител и как разходът се сравнява с ЕС."
            : "МВР is ~90% payroll — the cost of one employee and how the spend compares with the EU."
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <MvrPersonnelTile />
          <MvrEuPeerTile />
        </div>
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

      <PackFootnote
        unitCount={74}
        groupOf={{
          bg: "Министерството на вътрешните работи",
          en: "the Ministry of Interior",
        }}
        totalEur={groupTotalEur}
        afterLead={{
          bg: "; заглавната карта горе показва само централното МВР",
          en: "; the header card above shows only the central МВР",
        }}
        registerNote={{
          bg: "; класифицираните доставки за сигурност не са в него (виж „Какво се вижда и какво — не“ по-долу)",
          en: "; classified security buys are not in it (see “What is visible, and what is not” below)",
        }}
        bidCaveat={{
          bg: "Начинът на възлагане липсва за част от договорите, а броят оферти е известен за част от тях — затова делът „с една оферта“ е сред договорите с известни оферти.",
          en: "The procedure is missing for some contracts and the bid count is known for some, so the “single-bid” share is of bid-known contracts only.",
        }}
      />
    </section>
  );
};
