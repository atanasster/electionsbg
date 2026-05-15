// Card wrapper for the budget-flow графика. Mounts on /budget as a full-width
// stacked section: the side-by-side Sankeys + balance bridge need breathing
// room that the xl:grid-cols-2 tile slots can't give them.
//
// Above md, renders BudgetFlowGraphic (the SVG composition). Below md, falls
// back to a stacked grouped-bars + balance card layout — the графика's labels
// would collide on a phone viewport.

import { FC, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitFork } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { cn } from "@/lib/utils";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { formatEur } from "@/lib/currency";
import type { KfpSnapshot } from "@/data/budget/types";
import { useBudgetAdminFlow } from "@/data/budget/useBudget";
import type { AdminFlowFile, AdminFlowYear } from "@/data/budget/useBudget";
import {
  snapshotToFlowModel,
  snapshotToAdminFlowModel,
} from "./budgetFlowModel";
import type { FlowGrain } from "./budgetFlowModel";
import { BudgetFlowGraphic } from "./BudgetFlowGraphic";
import { BudgetFlowMobile } from "./BudgetFlowMobile";

// Generous canvas height so the outer leaf column has room for visible gaps
// between siblings (post-processed in BudgetFlowGraphic). The central total
// walls scale up proportionally, the leaves stay readable.
const HEIGHT = 720;
// Below this width labels overlap; the SVG falls back to horizontal scroll
// inside the card, mirroring the procurement Sankey's mobile policy. The
// spending side now has a depth-2 outer subcategory column, so the minimum
// is larger than before — four columns plus a wider label gutter.
const MIN_GRAPHIC_WIDTH = 1100;

// Under Bulgarian budget law, when a new State Budget Law isn't adopted before
// fiscal-year start, the prior year's law remains in force ("продължаваме на
// старо"). So if the snapshot's fiscal year has no admin-flow entry, fall back
// to the most recent year ≤ it that does — that's the plan still in effect.
const resolveAdminYear = (
  file: AdminFlowFile | undefined,
  fiscalYear: number,
): { year: AdminFlowYear; isFallback: boolean } | null => {
  if (!file) return null;
  const exact = file.fiscalYears[String(fiscalYear)];
  if (exact) return { year: exact, isFallback: false };
  const candidates = Object.values(file.fiscalYears)
    .filter((y) => y.fiscalYear <= fiscalYear)
    .sort((a, b) => b.fiscalYear - a.fiscalYear);
  const latest = candidates[0];
  return latest ? { year: latest, isFallback: true } : null;
};

const Legend: FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
      <LegendDot
        color="#10b981"
        label={t("budget_flow_legend_revenue") || "Revenue"}
      />
      <LegendDot
        color="#f43f5e"
        label={t("budget_flow_legend_spending") || "Spending"}
      />
      <LegendDot
        color="#2563eb"
        label={t("budget_series_euContribution") || "EU budget contribution"}
      />
      <LegendHatch
        color="#fb7185"
        label={t("budget_flow_legend_deficit") || "Deficit (financing)"}
      />
    </div>
  );
};

const LegendDot: FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="inline-flex items-center gap-1.5">
    <span
      className="inline-block h-2.5 w-2.5 rounded-sm"
      style={{ backgroundColor: color }}
    />
    {label}
  </span>
);

const LegendHatch: FC<{ color: string; label: string }> = ({
  color,
  label,
}) => (
  <span className="inline-flex items-center gap-1.5">
    <span
      className="inline-block h-2.5 w-2.5 rounded-sm"
      style={{
        backgroundImage: `repeating-linear-gradient(45deg, ${color} 0 2px, transparent 2px 5px)`,
        backgroundColor: "transparent",
      }}
    />
    {label}
  </span>
);

const GrainToggle: FC<{
  grain: FlowGrain;
  onChange: (g: FlowGrain) => void;
}> = ({ grain, onChange }) => {
  const { t } = useTranslation();
  const Btn: FC<{ value: FlowGrain; label: string }> = ({ value, label }) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={cn(
        "px-2.5 py-1 text-xs rounded-md border transition-colors",
        grain === value
          ? "border-primary bg-primary/10 text-primary font-semibold"
          : "border-border text-muted-foreground hover:text-foreground hover:border-primary/60",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground mr-1">
        {t("budget_flow_grain_label") || "Decompose by"}
      </span>
      <Btn
        value="economic"
        label={t("budget_flow_grain_economic") || "Category"}
      />
      <Btn
        value="admin"
        label={t("budget_flow_grain_admin") || "Spending unit"}
      />
    </div>
  );
};

export const BudgetFlowTile: FC<{ snapshot: KfpSnapshot }> = ({ snapshot }) => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const isMd = useMediaQueryMatch("md");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [grain, setGrain] = useState<FlowGrain>("economic");
  const { data: adminFlow } = useBudgetAdminFlow();
  const adminLookup = resolveAdminYear(adminFlow, snapshot.fiscalYear);
  const adminYear = adminLookup?.year ?? null;
  const isAdminFallback = adminLookup?.isFallback ?? false;
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setSize({ width: el.clientWidth, height: el.clientHeight });
    const ro = new ResizeObserver((entries) => {
      for (const ent of entries) {
        setSize({
          width: ent.contentRect.width,
          height: ent.contentRect.height,
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Admin grain is only available when the State Budget Law has been ingested
  // for this fiscal year. Fall back to economic grain if not.
  const effectiveGrain: FlowGrain =
    grain === "admin" && adminYear ? "admin" : "economic";

  // Cache labels by current language; t() identity changes on every render
  // and would otherwise re-create the model each tick, breaking the flow
  // graphic's animated tween (which compares previous vs current model).
  const revenueLabel = t("budget_flow_total_revenue") || "Revenue";
  const spendingLabel = t("budget_flow_total_spending") || "Spending";
  const otherLabel = t("budget_flow_admin_other") || "Other spending units";
  const directGroupLabel =
    t("budget_flow_admin_direct_group") || "Direct (per ministry)";
  const centralBudgetLabel =
    t("budget_flow_admin_central_budget") || "Central budget reserves";
  const transfersGroupLabel =
    t("budget_flow_admin_transfers_group") || "Transfers (net)";
  const euContributionLabel =
    t("budget_flow_admin_eu_contribution") || "EU contribution";

  const model = useMemo(() => {
    if (effectiveGrain === "admin" && adminYear) {
      return snapshotToAdminFlowModel(snapshot, adminYear, lang, {
        revenueLabel,
        spendingLabel,
        otherLabel,
        directGroupLabel,
        centralBudgetLabel,
        transfersGroupLabel,
        euContributionLabel,
      });
    }
    return snapshotToFlowModel(snapshot, lang, {
      revenueLabel,
      spendingLabel,
    });
  }, [
    snapshot,
    adminYear,
    effectiveGrain,
    lang,
    revenueLabel,
    spendingLabel,
    otherLabel,
    directGroupLabel,
    centralBudgetLabel,
    transfersGroupLabel,
    euContributionLabel,
  ]);

  const { revenueEur, spendingEur, balanceEur, isDeficit } = model.balance;

  return (
    <Card className="my-4" data-og="budget-flow">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <GitFork className="h-4 w-4" />
          {t("budget_flow_title") || "Budget flow"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("budget_breakdown_asof") || "as of"} {snapshot.asOf}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("budget_flow_intro") ||
            "Where the money comes from and where it goes — the gap is closed by financing."}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <Legend />
            {adminYear ? (
              <GrainToggle grain={effectiveGrain} onChange={setGrain} />
            ) : null}
            {adminYear && isAdminFallback && effectiveGrain === "admin" ? (
              <span className="text-[11px] text-amber-700 dark:text-amber-400">
                {t("budget_flow_admin_fallback_badge", {
                  fromYear: adminYear.fiscalYear,
                  toYear: snapshot.fiscalYear,
                }) ||
                  `Showing ${adminYear.fiscalYear} plan — ${snapshot.fiscalYear} budget not yet adopted`}
              </span>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            <strong className="text-foreground tabular-nums">
              {formatEur(revenueEur)}
            </strong>{" "}
            {t("budget_flow_in") || "in"} ·{" "}
            <strong className="text-foreground tabular-nums">
              {formatEur(spendingEur)}
            </strong>{" "}
            {t("budget_flow_out") || "out"} ·{" "}
            <strong
              className={
                isDeficit
                  ? "text-rose-600 tabular-nums"
                  : "text-emerald-600 tabular-nums"
              }
            >
              {formatEur(Math.abs(balanceEur))}{" "}
              {isDeficit
                ? t("budget_deficit") || "deficit"
                : t("budget_surplus") || "surplus"}
            </strong>
          </div>
        </div>
        {isMd ? (
          <div
            ref={containerRef}
            className="rounded-md border bg-card overflow-x-auto"
            style={{ height: HEIGHT }}
          >
            <div
              style={{
                minWidth: MIN_GRAPHIC_WIDTH,
                height: size.height || HEIGHT,
              }}
            >
              {size.width > 0 ? (
                <BudgetFlowGraphic
                  model={model}
                  width={Math.max(size.width, MIN_GRAPHIC_WIDTH)}
                  height={size.height || HEIGHT}
                />
              ) : null}
            </div>
          </div>
        ) : (
          <BudgetFlowMobile model={model} />
        )}
        <p className="text-[11px] text-muted-foreground/80">
          {effectiveGrain === "admin"
            ? isAdminFallback && adminYear
              ? t("budget_flow_admin_fallback_hint", {
                  fromYear: adminYear.fiscalYear,
                  toYear: snapshot.fiscalYear,
                }) ||
                `Both sides are the ${adminYear.fiscalYear} State Budget Law plan — the ${snapshot.fiscalYear} budget has not yet been adopted, so under continuing-appropriations rules the prior year's plan remains in force. The bridge shows the law-mandated deficit (V. БЮДЖЕТНО САЛДО). Click a ministry to drill down.`
              : adminYear?.plannedRevenue
                ? t("budget_flow_admin_law_source_hint") ||
                  "Both sides come from the State Budget Law plan — revenue tree on the left (Чл. 1, ал. 1), spending sections on the right (Чл. 1, ал. 2: direct appropriations + transfers + EU contribution). The bridge equals the law-mandated deficit. Click a ministry to drill down."
                : t("budget_flow_admin_source_hint") ||
                  "Spending decomposition: by spending unit (planned, from the State Budget Law). Direct unit appropriations only — total differs from the КФП execution figure shown on the revenue side. Click a ministry to drill down."
            : t("budget_flow_source_hint") ||
              "Built from the КФП monthly snapshot. Subtotal hierarchy is reconstructed from the source's flat label column."}
        </p>
      </CardContent>
    </Card>
  );
};
