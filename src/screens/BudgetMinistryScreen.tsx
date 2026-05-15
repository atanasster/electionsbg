// /budget/ministry/:id — one first-level spending unit's appropriations from
// the State Budget Law: per-year revenue / expenditure / balance, its program
// budget, and its public-procurement footprint. When the unit's annual
// program-budget execution report has been ingested, the year's stat cards
// also surface the уточнен план (amended) and the отчет (executed) below the
// law-planned figure.
//
// Performance: the screen makes ONE fetch — the pre-sliced
// ministries/<nodeId>.json rollup — instead of pulling every year's
// whole-corpus reconciliation files.

import { FC } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  Coins,
  Landmark,
  Scale,
  Receipt,
  ArrowRight,
  Users,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "./dashboard/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import type {
  MinistryProcurement,
  MinistryRollupYear,
  MinistrySeriesExecution,
} from "@/data/budget/types";

const numFmt = new Intl.NumberFormat("bg-BG");

const compactEur = (v: number): string => {
  if (Math.abs(v) >= 1_000_000_000)
    return `€${(v / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  return formatEur(v);
};

// Small footnote under a stat card's headline: "отчет €X (Y%) · неизразходвани €Z"
// when an execution report carries the executed-vs-amended pair for this series.
const ExecutionNote: FC<{ series: MinistrySeriesExecution | null }> = ({
  series,
}) => {
  const { t } = useTranslation();
  if (!series || !series.executed || !series.amended) return null;
  const pct =
    series.amended.amountEur !== 0
      ? (series.executed.amountEur / series.amended.amountEur) * 100
      : null;
  const unspent = series.amended.amountEur - series.executed.amountEur;
  return (
    <div className="mt-1 text-xs text-muted-foreground tabular-nums">
      <span>
        {t("budget_ministries_executed") || "executed"}{" "}
        {formatEur(series.executed.amountEur)}
        {pct != null ? (
          <>
            {" "}
            ({pct.toFixed(1)}%{" "}
            <span className="opacity-70">
              {t("budget_ministries_of_amended") || "of amended"}
            </span>
            )
          </>
        ) : null}
      </span>
      {unspent !== 0 ? (
        <span
          className={
            unspent < 0 ? "ml-2 text-rose-600 dark:text-rose-400" : "ml-2"
          }
        >
          ·{" "}
          {unspent > 0
            ? `${t("budget_ministries_unspent") || "unspent"} ${compactEur(unspent)}`
            : `${t("budget_ministries_over") || "over"} ${compactEur(-unspent)}`}
        </span>
      ) : null}
    </div>
  );
};

const SkeletonCard: FC = () => (
  <div className="rounded-xl border bg-card p-4 shadow-sm animate-pulse h-[110px]">
    <div className="h-3 w-24 bg-muted rounded mb-3" />
    <div className="h-7 w-32 bg-muted rounded" />
  </div>
);

const YearBlock: FC<{ year: MinistryRollupYear }> = ({ year }) => {
  const { t } = useTranslation();
  const deficit = (year.balance?.amountEur ?? 0) < 0;
  return (
    <div className="my-4">
      <h2 className="text-sm font-bold tabular-nums mb-2">
        {t("budget_fy_heading") || "Fiscal year"} {year.fiscalYear}
      </h2>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <StatCard label={t("budget_series_revenue") || "Revenue"}>
          <div className="flex items-baseline gap-2">
            <Coins className="h-5 w-5 text-emerald-600 shrink-0" />
            <span className="text-xl font-bold tabular-nums break-words">
              {year.revenue ? formatEur(year.revenue.amountEur) : "—"}
            </span>
          </div>
          <ExecutionNote series={year.execution?.revenue ?? null} />
        </StatCard>
        <StatCard label={t("budget_series_expenditure") || "Expenditure"}>
          <div className="flex items-baseline gap-2">
            <Landmark className="h-5 w-5 text-rose-600 shrink-0" />
            <span className="text-xl font-bold tabular-nums break-words">
              {year.expenditure ? formatEur(year.expenditure.amountEur) : "—"}
            </span>
          </div>
          <ExecutionNote series={year.execution?.expenditure ?? null} />
        </StatCard>
        <StatCard
          label={
            deficit
              ? t("budget_deficit") || "Budget deficit"
              : t("budget_surplus") || "Budget surplus"
          }
        >
          <div className="flex items-baseline gap-2">
            <Scale
              className={`h-5 w-5 shrink-0 ${
                deficit ? "text-rose-600" : "text-emerald-600"
              }`}
            />
            <span className="text-xl font-bold tabular-nums break-words">
              {year.balance ? formatEur(Math.abs(year.balance.amountEur)) : "—"}
            </span>
          </div>
        </StatCard>
      </div>
    </div>
  );
};

// The unit's program budget — the policy-area / program appropriations the
// State Budget Law sets, per fiscal year, as a proportional bar list.
const ProgramBlock: FC<{ years: MinistryRollupYear[]; lang: "bg" | "en" }> = ({
  years,
  lang,
}) => {
  const { t } = useTranslation();
  const withPrograms = years.filter((y) => y.programs.length > 0);
  if (withPrograms.length === 0) return null;
  return (
    <Card className="my-4" data-og="ministry-programs">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {t("budget_ministry_programs_title") || "Budget by program"}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {withPrograms.map((py) => {
          const max = Math.max(
            1,
            ...py.programs.map((p) => p.planned?.amountEur ?? 0),
          );
          return (
            <div
              key={py.fiscalYear}
              className="py-2 border-b border-border/40 last:border-b-0"
            >
              <div className="text-xs font-bold tabular-nums mb-1.5">
                {py.fiscalYear}
              </div>
              <ul className="space-y-1.5">
                {py.programs.map((p) => {
                  const v = p.planned?.amountEur ?? 0;
                  const ex = p.execution;
                  const execShare =
                    ex && ex.executed && ex.amended && ex.amended.amountEur > 0
                      ? Math.min(
                          100,
                          (ex.executed.amountEur / ex.amended.amountEur) * 100,
                        )
                      : 0;
                  return (
                    <li key={p.nodeId} className="text-xs">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-muted-foreground">
                          {lang === "en" && p.nameEn ? p.nameEn : p.nameBg}
                        </span>
                        <span className="tabular-nums shrink-0">
                          {formatEur(v)}
                        </span>
                      </div>
                      <div className="mt-0.5 h-1 rounded bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary/25"
                          style={{ width: "100%" }}
                        >
                          {ex && ex.executed ? (
                            <div
                              className="h-full rounded bg-primary/80"
                              style={{ width: `${execShare}%` }}
                            />
                          ) : (
                            <div
                              className="h-full rounded bg-primary/60"
                              style={{ width: `${(v / max) * 100}%` }}
                            />
                          )}
                        </div>
                      </div>
                      {ex && ex.executed && ex.variancePct != null ? (
                        <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                          {t("budget_ministries_executed") || "executed"}{" "}
                          {formatEur(ex.executed.amountEur)}
                          {ex.amended && ex.amended.amountEur > 0 ? (
                            <>
                              {" "}
                              (
                              {(
                                (ex.executed.amountEur / ex.amended.amountEur) *
                                100
                              ).toFixed(1)}
                              %{" "}
                              <span className="opacity-70">
                                {t("budget_ministries_of_amended") ||
                                  "of amended"}
                              </span>
                              )
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

// Phase 4 — the spending unit's public-procurement footprint, linking the
// budget pillar through to the contracts it actually awarded.
const ProcurementBlock: FC<{ procurement: MinistryProcurement }> = ({
  procurement,
}) => {
  const { t } = useTranslation();
  return (
    <Card className="my-4" data-og="ministry-procurement">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          {t("budget_ministry_procurement_title") || "Public procurement"}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <div className="flex items-baseline gap-2">
          <Coins className="h-5 w-5 text-amber-600 shrink-0" />
          <span className="text-xl font-bold tabular-nums">
            {formatEur(procurement.totalEur)}
          </span>
          <span className="text-sm text-muted-foreground">
            {t("budget_ministry_procurement_across") || "across"}{" "}
            {numFmt.format(procurement.contractCount)}{" "}
            {t("budget_ministry_procurement_contracts") || "contracts"}
          </span>
        </div>
        {procurement.mpConnectedContractorCount > 0 ? (
          <div className="flex items-baseline gap-1.5 text-sm">
            <Users className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="tabular-nums font-medium">
              {numFmt.format(procurement.mpConnectedContractorCount)}
            </span>
            <span className="text-muted-foreground">
              {t("budget_ministry_procurement_mp") ||
                "MP-connected contractor(s) paid by this unit"}
            </span>
          </div>
        ) : null}
        <Link
          to={`/awarder/${procurement.eik}`}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {t("budget_ministry_procurement_link") ||
            "View this unit's procurement contracts"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
};

export const BudgetMinistryScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useBudgetMinistryRollup(id);
  const lang = i18n.language === "bg" ? "bg" : "en";

  const backLink = (
    <Link
      to="/budget"
      className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground hover:underline"
    >
      <ChevronLeft className="h-3.5 w-3.5" />
      {t("budget_index_title") || "State budget"}
    </Link>
  );

  if (isLoading) {
    return (
      <section className="my-4 space-y-4">
        {backLink}
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="my-4 space-y-4">
        {backLink}
        <p className="text-sm text-muted-foreground">
          {t("budget_ministry_not_found") ||
            "No budget-law data found for this spending unit."}
        </p>
      </section>
    );
  }

  const name = lang === "bg" ? data.nameBg : data.nameEn || data.nameBg;

  return (
    <>
      <Title description={`${name} — state budget appropriations`}>
        {name}
      </Title>
      {/* If any year carries execution data, replace the "not yet ingested"
          note with the version that acknowledges the integrated отчет. */}
      <section aria-label={name} className="my-4">
        {backLink}
        <p className="mt-3 text-sm text-muted-foreground">
          {data.years.some((y) => y.execution)
            ? t("budget_ministry_intro_with_execution") ||
              "Appropriations from the State Budget Law plus actual execution from the year-end program-budget report (Отчет за изпълнението на програмния бюджет)."
            : t("budget_ministry_intro") ||
              "Appropriations set by the State Budget Law. Ministry-level execution (actual spending) is published in the year-end execution report and is not yet ingested."}
        </p>
        {data.years.map((year) => (
          <YearBlock key={year.fiscalYear} year={year} />
        ))}
        <ProgramBlock years={data.years} lang={lang} />
        {data.procurement ? (
          <ProcurementBlock procurement={data.procurement} />
        ) : null}
      </section>
    </>
  );
};
