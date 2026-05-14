// /budget/ministry/:id — one first-level spending unit's appropriations from
// the State Budget Law, across every fiscal year that has law data. Phase 3
// admin-grain increment: plan figures only — ministry-level execution comes
// from the year-end execution report, a later increment, so the screen is
// explicit that these are appropriations, not actuals.

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
import { useBudgetMinistry } from "@/data/budget/useBudgetReconciliation";
import type { MinistryYearFigures } from "@/data/budget/useBudgetReconciliation";
import { useMinistryProcurement } from "@/data/budget/useBudget";

const numFmt = new Intl.NumberFormat("bg-BG");

const SkeletonCard: FC = () => (
  <div className="rounded-xl border bg-card p-4 shadow-sm animate-pulse h-[110px]">
    <div className="h-3 w-24 bg-muted rounded mb-3" />
    <div className="h-7 w-32 bg-muted rounded" />
  </div>
);

const YearBlock: FC<{ figures: MinistryYearFigures }> = ({ figures }) => {
  const { t } = useTranslation();
  const deficit = (figures.balance?.amountEur ?? 0) < 0;
  return (
    <div className="my-4">
      <h2 className="text-sm font-bold tabular-nums mb-2">
        {t("budget_fy_heading") || "Fiscal year"} {figures.fiscalYear}
      </h2>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <StatCard label={t("budget_series_revenue") || "Revenue"}>
          <div className="flex items-baseline gap-2">
            <Coins className="h-5 w-5 text-emerald-600 shrink-0" />
            <span className="text-xl font-bold tabular-nums break-words">
              {figures.revenue ? formatEur(figures.revenue.amountEur) : "—"}
            </span>
          </div>
        </StatCard>
        <StatCard label={t("budget_series_expenditure") || "Expenditure"}>
          <div className="flex items-baseline gap-2">
            <Landmark className="h-5 w-5 text-rose-600 shrink-0" />
            <span className="text-xl font-bold tabular-nums break-words">
              {figures.expenditure
                ? formatEur(figures.expenditure.amountEur)
                : "—"}
            </span>
          </div>
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
              {figures.balance
                ? formatEur(Math.abs(figures.balance.amountEur))
                : "—"}
            </span>
          </div>
        </StatCard>
      </div>
    </div>
  );
};

// Phase 4 — the spending unit's public-procurement footprint, linking the
// budget pillar through to the contracts it actually awarded.
const ProcurementBlock: FC<{ nodeId: string }> = ({ nodeId }) => {
  const { t } = useTranslation();
  const { data: procFile } = useMinistryProcurement();
  const entry = procFile?.entries.find((e) => e.nodeId === nodeId);
  if (!entry) return null;
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
            {formatEur(entry.totalEur)}
          </span>
          <span className="text-sm text-muted-foreground">
            {t("budget_ministry_procurement_across") || "across"}{" "}
            {numFmt.format(entry.contractCount)}{" "}
            {t("budget_ministry_procurement_contracts") || "contracts"}
          </span>
        </div>
        {entry.mpConnectedContractorCount > 0 ? (
          <div className="flex items-baseline gap-1.5 text-sm">
            <Users className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="tabular-nums font-medium">
              {numFmt.format(entry.mpConnectedContractorCount)}
            </span>
            <span className="text-muted-foreground">
              {t("budget_ministry_procurement_mp") ||
                "MP-connected contractor(s) paid by this unit"}
            </span>
          </div>
        ) : null}
        <Link
          to={`/awarder/${entry.eik}`}
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
  const { data, isLoading } = useBudgetMinistry(id);
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
      <section aria-label={name} className="my-4">
        {backLink}
        <p className="mt-3 text-sm text-muted-foreground">
          {t("budget_ministry_intro") ||
            "Appropriations set by the State Budget Law. Ministry-level execution (actual spending) is published in the year-end execution report and is not yet ingested."}
        </p>
        {data.years.map((figures) => (
          <YearBlock key={figures.fiscalYear} figures={figures} />
        ))}
        {id ? <ProcurementBlock nodeId={id} /> : null}
      </section>
    </>
  );
};
