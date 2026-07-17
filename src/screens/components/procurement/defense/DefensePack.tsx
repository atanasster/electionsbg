// Отбрана (defense / МО) sector pack — the defense-specific procurement visuals,
// rendered inside the generic awarder dashboard (/awarder/000695324). Like the
// roads/НОИ/НЗОК/ВСС/Води packs it renders ONLY the domain-unique tiles; the
// generic buy-side tiles already sit on the awarder page above it.
//
// THESIS: sustainment is visible, acquisition is not. The МО group's €2bn+ of
// ЗОП contracts (25 budget units) are real aviation & vehicle sustainment; F-16
// and Stryker acquisition go through US FMS and never hit the corpus. So the pack
// is contract-led AND names the gap (DefenseTransparencyTile).
//
// Renders off the EXISTING corpus — the budget bridge (procurement inside the МО
// budget), consolidated group roll-up, contractor HHI, per-unit competition
// heatmap, by-function split, transparency. The %GDP path, mega-programs, exports
// and readiness live on the dedicated /defense screen. See the plan doc.
//
// NOTE: ВМА (health) is ~47% of the group's value and buys drugs; the universe
// Select lets the reader drop it / isolate a universe so "what МО buys" isn't
// medicines.

import { FC, useMemo, useState } from "react";
import { Link, useSearchParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Shield,
  Boxes,
  PieChart,
  Gauge,
  ShieldAlert,
  Landmark,
} from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";
import { PackSelect } from "../PackSelect";
import { WARN_CHIP_COLORS } from "../chipStyles";
import { PackSection } from "../PackSection";
import { useHashScroll } from "@/ux/useHashScroll";
import { useDefense, type ScopeWindow } from "@/data/procurement/useDefense";
import {
  categoryLabel,
  categoryCpvDivs,
  type DefenseCategory,
} from "@/lib/defenseAttributes";
import { buildPackInsights, type PackInsight } from "@/lib/packInsights";
import {
  DEFENSE_UNIVERSES,
  universeLabel,
  VMA_EIK,
  type DefenseUniverse,
} from "@/lib/defenseReferenceData";
import { VikContractorHhiTile } from "../vik/VikContractorHhiTile";
import { DefenseBudgetBridgeTile } from "./DefenseBudgetBridgeTile";
import { DefenseCompetitionTile } from "./DefenseCompetitionTile";
import { DefenseCategoryTile } from "./DefenseCategoryTile";
import { DefenseTransparencyTile } from "./DefenseTransparencyTile";

type UniverseFilter = DefenseUniverse | "all" | "no_vma";

export const DefensePack: FC<{ eik: string; scopeWindow: ScopeWindow }> = ({
  eik,
  scopeWindow,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const [universe, setUniverse] = useState<UniverseFilter>("all");
  const { model, units, groupTotalEur, isLoading } = useDefense(
    eik,
    scopeWindow,
    universe,
  );

  // "Per year" divisor = the length of the SCOPE WINDOW (not the contract span),
  // so an edge gap year doesn't inflate the average — same rule as the ВСС/Води
  // packs.
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
  // Then the headline KPI is a per-year figure; a partial window (e.g. the current
  // parliament, from an election date) shows the period TOTAL, labelled "за периода".
  const yearAligned = useMemo(() => {
    const from = scopeWindow?.from;
    const to = scopeWindow?.to;
    if (!from && !to) return true;
    return !!from && from.endsWith("-01-01") && !!to && to.endsWith("-01-01");
  }, [scopeWindow]);
  const procValue = yearAligned ? annualProc : (model?.totalEur ?? null);

  // Drill-down links. contractsHref carries the current scope onto
  // /procurement/contracts?sector=defense, plus optional overrides (cpv / pscope).
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const contractsHref = (extra?: Record<string, string>) => {
    const p = new URLSearchParams(searchParams);
    p.set("sector", "defense");
    if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/procurement/contracts?${p.toString()}`;
  };
  const anchorHref = (id: string) =>
    `${location.pathname}${location.search}#${id}`;
  const insightHref = (it: PackInsight): string | undefined => {
    if (it.kind === "peak" && it.year != null)
      return contractsHref({ pscope: `y:${it.year}` });
    if (it.kind === "category" && it.categoryId) {
      const divs = categoryCpvDivs(it.categoryId as DefenseCategory);
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

  // ВМА share of the WHOLE group (independent of the active filter) — the headline
  // caveat, so the reader knows military health dominates before they read the
  // split. Uses the ВМА ENTITY total (its no-CPV rows land in the "other"
  // category, so the health CPV slice alone understates it — €1.0bn vs €459M).
  const vmaShare = useMemo(() => {
    if (universe !== "all" || groupTotalEur <= 0) return null;
    const vma = units.find((u) => u.eik === VMA_EIK);
    return vma ? vma.totalEur / groupTotalEur : null;
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
        <Shield className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Отбрана (МО)" : "Defense (МО)"}
        </h2>
        {/* Universe segmentation — default "МО група"; "без ВМА" / a universe. */}
        <PackSelect
          value={universe}
          onChange={setUniverse}
          ariaLabel={bg ? "Избор на структури" : "Select units"}
          className="ml-auto"
          options={[
            {
              value: "all" as UniverseFilter,
              label: bg ? "Цялата МО група" : "Whole МО group",
            },
            {
              value: "no_vma" as UniverseFilter,
              label: bg ? "Без ВМА (медицина)" : "Excluding ВМА (medical)",
            },
            ...DEFENSE_UNIVERSES.map((u) => ({
              value: u as UniverseFilter,
              label: universeLabel(u, lang),
            })),
          ]}
        />
      </div>

      {/* Domain-only KPIs — the generic per-EIK total/contracts/suppliers KPIs
          sit in the awarder header above; keep only the group-only figures. */}
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
              ? "Брой военни структури с договори в обхвата. Виж ги по структура →"
              : "МО budget units with contracts in scope. See them by unit →"
          }
        >
          <span className="text-2xl font-bold tabular-nums">
            {units.length}
          </span>
        </StatCard>
        {vmaShare != null && (
          <StatCard
            label={bg ? "От което ВМА" : "Of which ВМА"}
            to={`/awarder/${VMA_EIK}`}
            hint={
              bg
                ? "Дял на военната медицина (лекарства, болнично) в стойността на групата. Използвайте филтъра „без ВМА“. Виж институцията →"
                : "Military-health (drugs, hospital) share of the group's value. Use the “excluding ВМА” filter. See the institution →"
            }
          >
            <span className="text-2xl font-bold tabular-nums">
              {Math.round(vmaShare * 100)}%
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

      {/* Money-first bands: budget bridge (the small competed slice inside the
          whole budget) → what МО buys → who wins it → competition → transparency. */}
      <PackSection
        icon={Landmark}
        id="mo-budget"
        title={bg ? "В мащаба на бюджета" : "At the scale of the budget"}
      >
        <DefenseBudgetBridgeTile procEur={procValue} perYear={yearAligned} />
      </PackSection>

      <PackSection
        icon={Boxes}
        id="mo-category"
        title={bg ? "Какво купува МО" : "What МО buys"}
        sub={
          bg
            ? "Договорите на групата, групирани по оперативна функция."
            : "The group's contracts grouped by operating function."
        }
      >
        <DefenseCategoryTile
          categories={model.categories}
          totalEur={model.totalEur}
        />
      </PackSection>

      <PackSection
        icon={PieChart}
        id="mo-suppliers"
        title={bg ? "Пазар на изпълнителите" : "The contractor market"}
        sub={
          bg
            ? "Колко концентрирана е стойността сред изпълнителите (HHI)."
            : "How concentrated the value is among contractors (HHI)."
        }
      >
        <VikContractorHhiTile
          suppliers={model.suppliers}
          totalEur={model.totalEur}
        />
      </PackSection>

      <PackSection
        icon={Gauge}
        id="mo-competition"
        title={bg ? "Конкуренция" : "Competition"}
        sub={
          bg
            ? "Дял на договорите с една оферта — по структура."
            : "Single-bidder share — by unit."
        }
      >
        <DefenseCompetitionTile units={units} />
      </PackSection>

      <PackSection
        icon={ShieldAlert}
        id="mo-transparency"
        title={bg ? "Прозрачност" : "Transparency"}
        sub={
          bg
            ? "Кое от отбраната минава през открити процедури и кое — не."
            : "Which defense spending runs through open procedure, and which does not."
        }
      >
        <DefenseTransparencyTile groupTotalEur={groupTotalEur} />
      </PackSection>

      <p className="text-[11px] text-muted-foreground/80">
        {bg ? (
          <>
            Консолидиран изглед по 25 структури на Министерството на отбраната (
            {formatEurCompact(groupTotalEur, lang)}); заглавната карта горе
            показва само централното МО. Поръчките са от регистъра (АОП/ЦАИС
            ЕОП); придобиването на F-16 и Stryker е по US FMS и не е в него (виж
            „Прозрачност“). Начинът на възлагане липсва за ~половината договори,
            а броят оферти е известен за ~45% — затова делът „с една оферта“ е
            сред договорите с известни оферти.
          </>
        ) : (
          <>
            Consolidated across 25 Ministry of Defence units (
            {formatEurCompact(groupTotalEur, lang)}); the header card above
            shows only the central МО. Procurement is from the register
            (АОП/ЦАИС ЕОП); F-16 and Stryker acquisition runs through US FMS and
            is not in it (see “Transparency”). The procedure is missing for
            ~half the contracts and the bid count is known for ~45%, so the
            “single-bid” share is of bid-known contracts only.
          </>
        )}
      </p>
    </section>
  );
};
