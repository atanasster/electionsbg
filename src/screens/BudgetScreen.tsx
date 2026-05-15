// /budget — state budget dashboard, scoped to the selected election.
//
// A parliament's term can span several fiscal years (several budget laws), so
// the screen lists every fiscal year overlapping the term and lets the user
// pick which one to drill into. The headline cards show FULL-YEAR figures:
// the December cumulative for a complete year, a seasonal projection for the
// current one, or actual-so-far when no projection can be anchored yet.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Coins,
  Landmark,
  Scale,
  Flag,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "./dashboard/StatCard";
import { cn } from "@/lib/utils";
import { formatEur } from "@/lib/currency";
import {
  useBudgetIndex,
  useKfp,
  useBudgetDocuments,
} from "@/data/budget/useBudget";
import { useBudgetTerm } from "@/data/budget/useBudgetTerm";
import type { FiscalYearSummary } from "@/data/budget/types";
import { seriesView, type FySeries } from "@/data/budget/fiscalYear";
import { BudgetTrendTile } from "./components/budget/BudgetTrendTile";
import { BudgetSamePointTile } from "./components/budget/BudgetSamePointTile";
import { BudgetFlowTile } from "./components/budget/BudgetFlowTile";
import { BudgetJourneyTile } from "./components/budget/BudgetJourneyTile";
import { BudgetMinistriesTile } from "./components/budget/BudgetMinistriesTile";
import { BudgetVarianceTile } from "./components/budget/BudgetVarianceTile";

const SkeletonCard: FC = () => (
  <div className="rounded-xl border bg-card p-4 shadow-sm animate-pulse h-[120px]">
    <div className="h-3 w-24 bg-muted rounded mb-3" />
    <div className="h-7 w-32 bg-muted rounded" />
  </div>
);

// One headline figure card for the selected fiscal year.
const FigureCard: FC<{
  label: string;
  icon: typeof Coins;
  iconTone: string;
  fy: FiscalYearSummary;
  series: FySeries;
  ringTone?: string;
  // balance is shown as an absolute value with a deficit/surplus label
  absolute?: boolean;
  gdpEur?: number | null;
}> = ({
  label,
  icon: Icon,
  iconTone,
  fy,
  series,
  ringTone,
  absolute,
  gdpEur,
}) => {
  const { t } = useTranslation();
  const v = seriesView(fy, series);
  const headline = absolute ? Math.abs(v.value) : v.value;
  const pct =
    v.planValue && v.planValue !== 0
      ? `${((v.value / v.planValue) * 100).toFixed(1)}%`
      : null;
  const gdpShare =
    gdpEur && gdpEur > 0
      ? `${((Math.abs(v.value) / gdpEur) * 100).toFixed(1)}%`
      : null;

  return (
    <StatCard label={label} className={ringTone}>
      <div className="flex items-baseline gap-2">
        <Icon className={`h-5 w-5 shrink-0 ${iconTone}`} />
        <span className="text-xl md:text-2xl font-bold tabular-nums break-words">
          {formatEur(headline)}
        </span>
      </div>
      {gdpShare ? (
        <div className="text-xs text-muted-foreground tabular-nums">
          {gdpShare} {t("budget_of_gdp") || "of GDP"}
        </div>
      ) : null}
      {v.mode === "projected" ? (
        <div className="text-xs text-muted-foreground">
          <span className="inline-block rounded bg-amber-100 px-1 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            {t("budget_mode_projected") || "projected"}
          </span>{" "}
          <span className="tabular-nums">
            {t("budget_executed_sofar") || "so far"}{" "}
            {formatEur(
              absolute ? Math.abs(v.actualSoFar ?? 0) : (v.actualSoFar ?? 0),
            )}
          </span>
        </div>
      ) : null}
      {v.mode === "actual" && pct ? (
        <div className="text-xs text-muted-foreground tabular-nums">
          {pct} {t("budget_of_plan") || "of plan"}
          {v.planValue != null
            ? ` · ${t("budget_planned") || "plan"} ${formatEur(
                absolute ? Math.abs(v.planValue) : v.planValue,
              )}`
            : ""}
        </div>
      ) : null}
      {v.mode === "partial" ? (
        <div className="text-xs text-muted-foreground">
          {t("budget_projection_pending") ||
            "full-year projection pending — needs a prior fiscal year for the seasonal baseline"}
        </div>
      ) : null}
    </StatCard>
  );
};

// The fiscal-year selector — one chip per fiscal year overlapping the term.
const FiscalYearSelector: FC<{
  years: ReturnType<typeof useBudgetTerm>["years"];
  selectedFy: number | null;
  onSelect: (fy: number) => void;
}> = ({ years, selectedFy, onSelect }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("budget_year_select_label") || "Fiscal year"}
      </span>
      {years.map((y) => {
        // useBudgetTerm only lists years with ingested data (KFP summary OR a
        // law/amendment/execution stage), so every chip is selectable. The
        // status text distinguishes the depth of data behind it.
        const active = y.fiscalYear === selectedFy;
        const status = y.summary
          ? y.summary.complete
            ? t("budget_fy_status_complete") || "executed"
            : t("budget_fy_status_inprogress") || "in progress"
          : t("budget_fy_status_law_only") || "law plan";
        return (
          <button
            key={y.fiscalYear}
            type="button"
            onClick={() => onSelect(y.fiscalYear)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm tabular-nums transition-colors",
              active
                ? "border-primary bg-primary/10 text-primary font-semibold"
                : "border-border hover:border-primary/60 hover:bg-accent/10",
            )}
          >
            <span>{y.fiscalYear}</span>
            <span className="ml-1.5 text-[11px] font-normal opacity-70">
              {status}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export const BudgetScreen: FC = () => {
  const { t } = useTranslation();
  const { data: index, isLoading: indexLoading } = useBudgetIndex();
  const { data: kfp, isLoading: kfpLoading } = useKfp();
  const { data: documents } = useBudgetDocuments();
  const term = useBudgetTerm(index);

  const title = t("budget_index_title") || "State budget";
  const description =
    t("budget_index_description") ||
    "Bulgarian state budget execution — revenue, spending and the deficit, from data.egov.bg.";

  if (indexLoading || kfpLoading) {
    return (
      <>
        <Title description={description}>{title}</Title>
        <section aria-label={title} className="my-4">
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </section>
      </>
    );
  }

  const selectedYear = term.years.find((y) => y.fiscalYear === term.selectedFy);
  const summary = selectedYear?.summary ?? null;

  // No budget data anywhere in this parliament's term.
  if (!index || !kfp || term.selectedFy == null) {
    return (
      <>
        <Title description={description}>{title}</Title>
        <section aria-label={title} className="my-4 space-y-4">
          {term.years.length > 0 ? (
            <FiscalYearSelector
              years={term.years}
              selectedFy={term.selectedFy}
              onSelect={term.setSelectedFy}
            />
          ) : null}
          <p className="text-sm text-muted-foreground">
            {t("budget_term_no_data") ||
              "No budget data for this parliament's term yet."}
          </p>
        </section>
      </>
    );
  }

  const termFys = new Set(term.years.map((y) => y.fiscalYear));
  const scopedObservations = kfp.observations.filter((o) =>
    termFys.has(o.fiscalYear),
  );
  const scopedDocuments = (documents?.documents ?? []).filter(
    (d) => d.fiscalYear == null || termFys.has(d.fiscalYear),
  );
  const snapshot =
    kfp.snapshots.find((s) => s.fiscalYear === term.selectedFy) ?? null;

  // Status line + headline cards key off `summary` (KFP-driven). When the year
  // has only law/execution stages (no КФП yet), we render a lighter heading and
  // skip the headline cards; the ministries / journey tiles still render below.
  const statusText = summary
    ? summary.complete
      ? `${t("budget_fy_status_complete") || "executed"} · ${t("budget_breakdown_asof") || "as of"} ${summary.asOf}`
      : `${t("budget_fy_status_inprogress") || "in progress"} · ${t("budget_breakdown_asof") || "as of"} ${summary.asOf} (${summary.monthsAvailable} ${t("budget_months_short") || "mo"})`
    : t("budget_fy_status_law_only_long") ||
      "law plan only — no monthly execution feed for this year yet";

  const deficit = (summary?.actual.balance?.amountEur ?? 0) < 0;

  const gdpEur = summary?.gdpEur ?? null;

  return (
    <>
      <Title description={description}>{title}</Title>
      <section aria-label={title} className="my-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <FiscalYearSelector
              years={term.years}
              selectedFy={term.selectedFy}
              onSelect={term.setSelectedFy}
            />
            <Link
              to="/budget/methodology"
              className="text-primary hover:underline inline-flex items-center gap-1 text-sm"
            >
              {t("budget_methodology_link") || "How this is built"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="text-sm text-muted-foreground">
            <strong className="text-foreground">
              {t("budget_fy_heading") || "Fiscal year"} {term.selectedFy}
            </strong>{" "}
            — {statusText}
          </div>
        </div>

        {summary ? (
          <div
            className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mt-4"
            data-og="budget-stats"
          >
            <FigureCard
              label={t("budget_series_revenue") || "Revenue"}
              icon={Coins}
              iconTone="text-emerald-600"
              fy={summary}
              series="revenue"
              gdpEur={gdpEur}
            />
            <FigureCard
              label={t("budget_series_expenditure") || "Expenditure"}
              icon={Landmark}
              iconTone="text-rose-600"
              fy={summary}
              series="expenditure"
              gdpEur={gdpEur}
            />
            <FigureCard
              label={
                t("budget_series_euContribution") || "EU budget contribution"
              }
              icon={Flag}
              iconTone="text-blue-600"
              fy={summary}
              series="euContribution"
              gdpEur={gdpEur}
            />
            <FigureCard
              label={
                deficit
                  ? t("budget_deficit") || "Budget deficit"
                  : t("budget_surplus") || "Budget surplus"
              }
              icon={Scale}
              iconTone={deficit ? "text-rose-600" : "text-emerald-600"}
              fy={summary}
              series="balance"
              absolute
              gdpEur={gdpEur}
              ringTone={
                deficit
                  ? "ring-1 ring-rose-200/60 dark:ring-rose-800/40"
                  : "ring-1 ring-emerald-200/60 dark:ring-emerald-800/40"
              }
            />
          </div>
        ) : null}

        {scopedObservations.length > 0 ? (
          <BudgetTrendTile
            observations={scopedObservations}
            allObservations={kfp.observations}
          />
        ) : null}

        {summary && !summary.complete ? (
          <BudgetSamePointTile
            observations={kfp.observations}
            fiscalYear={term.selectedFy}
            monthsAvailable={summary.monthsAvailable}
          />
        ) : null}

        {snapshot ? <BudgetFlowTile snapshot={snapshot} /> : null}

        <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
          <BudgetVarianceTile fiscalYear={term.selectedFy} />
          <BudgetMinistriesTile fiscalYear={term.selectedFy} />
        </div>

        <BudgetJourneyTile documents={scopedDocuments} index={index} />

        <p className="text-[11px] text-muted-foreground/80 mt-4">
          {t("budget_index_source_hint") ||
            "Source: Ministry of Finance — state budget execution by major budget indicators, published on"}{" "}
          <a
            href="https://data.egov.bg/data/view/79ce7de2-0150-4ba7-a96c-dbacb76c95b6"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-0.5"
          >
            data.egov.bg <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </section>
    </>
  );
};
