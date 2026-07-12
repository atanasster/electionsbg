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
import { useDefense, type ScopeWindow } from "@/data/procurement/useDefense";
import { categoryLabel } from "@/lib/defenseAttributes";
import { buildPackInsights } from "@/lib/packInsights";
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
        <Select
          value={universe}
          onValueChange={(v) => setUniverse(v as UniverseFilter)}
        >
          <SelectTrigger className="ml-auto h-7 w-auto min-w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              {bg ? "Цялата МО група" : "Whole МО group"}
            </SelectItem>
            <SelectItem value="no_vma" className="text-xs">
              {bg ? "Без ВМА (медицина)" : "Excluding ВМА (medical)"}
            </SelectItem>
            {DEFENSE_UNIVERSES.map((u) => (
              <SelectItem key={u} value={u} className="text-xs">
                {universeLabel(u, lang)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Domain-only KPIs — the generic per-EIK total/contracts/suppliers KPIs
          sit in the awarder header above; keep only the group-only figures. */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={bg ? "Поръчки на година" : "Procurement per year"}
          hint={
            bg
              ? `Договорена стойност, усреднена за обхвата${procSpan ? ` (${procSpan.from}–${procSpan.to})` : ""}.`
              : `Contracted value, averaged over the scope${procSpan ? ` (${procSpan.from}–${procSpan.to})` : ""}.`
          }
        >
          <span className="text-2xl font-bold tabular-nums">
            {annualProc != null ? formatEurCompact(annualProc, lang) : "—"}
          </span>
        </StatCard>
        <StatCard
          label={bg ? "Структури с договори" : "Units with contracts"}
          hint={
            bg
              ? "Брой военни структури с договори в обхвата."
              : "МО budget units with contracts in scope."
          }
        >
          <span className="text-2xl font-bold tabular-nums">
            {units.length}
          </span>
        </StatCard>
        {vmaShare != null && (
          <StatCard
            label={bg ? "От което ВМА" : "Of which ВМА"}
            hint={
              bg
                ? "Дял на военната медицина (лекарства, болнично) в стойността на групата. Използвайте филтъра „без ВМА“."
                : "Military-health (drugs, hospital) share of the group's value. Use the “excluding ВМА” filter."
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
      )}

      {/* Money-first bands: budget bridge (the small competed slice inside the
          whole budget) → what МО buys → who wins it → competition → transparency. */}
      <PackSection
        icon={Landmark}
        id="mo-budget"
        title={bg ? "В мащаба на бюджета" : "At the scale of the budget"}
        sub={
          bg
            ? "Колко малка част от парите за отбрана минават през конкурентни поръчки."
            : "How small a slice of defence money runs through competitive procurement."
        }
      >
        <DefenseBudgetBridgeTile annualProcEur={annualProc} />
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
