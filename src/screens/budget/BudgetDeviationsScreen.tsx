// /budget/deviations — план → изменен план → отчет, per spending unit.
//
// Plan: docs/plans/budget-hub-v1.md §7.3 / T6.5.
//
// THREE THINGS DECIDE THIS PAGE, and each replaces something the old tile did:
//
//   1. THE COVERAGE LINE COMES FIRST, ABOVE THE RANKING. 8 of 48 units filed an
//      execution report in the best year and 0 in six of the nine (§2.3). A
//      top-N served without that pair asserts „these are the government's
//      biggest deviations" over a corpus that cannot support it. The skill's
//      §11 rule: a hub surfaces a data layer, it does not repair one.
//   2. TWO DELTAS, BOTH NAMED. „A ministry overspent its appropriation" and
//      „parliament re-voted the appropriation" are different findings, and a
//      single „отклонение" column collapses them and silently picks the first
//      (§2.2's fourth trap). The data already carries all three columns per
//      row, so naming both costs nothing.
//   3. A YEAR WITH NO REPORTS IS A FINDING, NOT A BLANK. FY2026 has 0 of 44.
//      The page says which, and does not draw an empty table under a heading
//      that implies the ministries deviated by nothing.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Title } from "@/ux/Title";
import { formatEur, formatEurSigned } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { useBudgetVariance } from "@/data/budget/useBudgetVariance";
import { useBudgetHubStats } from "@/data/budget/useBudgetHubStats";

/** A signed euro delta. `null` renders as an em dash rather than as zero —
 *  „no report" and „spent exactly the appropriation" are different facts. */
const Delta: FC<{ value: number | null }> = ({ value }) => {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  // The sign goes OUTSIDE the symbol. `formatEur(-1365386)` is „€-1 365 386",
  // which puts the minus between the currency and the digits and is easy to
  // read past on a column where the sign is the whole point.
  // NO red/green. Neither direction is good or bad here: the note beneath the
  // table says a wide law-delta usually means the ceiling MOVED, so colouring
  // it red contradicts the page's own explanation in the same row — МО is red
  // for +€740m and green for −€1.4m simultaneously — and it would read a
  // ministry's €438m under-execution as a success. The SIGN carries the
  // direction; weight carries the emphasis.
  return (
    <span
      className={cn(
        "tabular-nums",
        value === 0 ? "text-muted-foreground" : "font-medium",
      )}
    >
      {formatEurSigned(value, undefined, { plusForPositive: true })}
    </span>
  );
};

export const BudgetDeviationsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const [fyParam, setFyParam] = useSearchParam("fy", { replace: true });
  const { stats } = useBudgetHubStats();
  const fy =
    fyParam && /^\d{4}$/.test(fyParam)
      ? Number(fyParam)
      : (stats?.fiscalYear ?? null);

  const { variance, isLoading } = useBudgetVariance(fy);

  // „Nobody filed" means two different things and the page must not merge them.
  // An execution report cannot exist for a year that has not closed, so FY2026
  // at 0 of 44 is the CALENDAR; a closed year nobody reported on is the finding
  // this page exists to surface.
  //
  // The fact comes from `budget_fiscal_year.complete`, NOT from „is this the
  // newest year in the list". Those two disagree every January: the just-closed
  // year is still the newest one the КФП feed has, so an inferred test would
  // tell the reader it is still running for two months a year, exactly when the
  // overdue reports start mattering.
  const yearHasClosed = variance?.complete === true;
  const rows = useMemo(() => variance?.rows ?? [], [variance]);

  // Whether ANY row in this year carries an adjusted plan. Some years have
  // none, and a permanent column of em dashes reads as missing data rather than
  // as „the ceiling did not move".
  //
  // Per-year for the COLUMNS and per-ROW for the cells: a year can have some
  // units adjusted and others not (FY2024 revenue is 6 covered / 5 adjusted
  // today), and for an unadjusted row `deltaVsAmended` is `executed − planned`
  // — the SAME number as the law delta. Printed under a second heading it reads
  // as an independent finding that happens to agree, which is the one thing
  // two columns must never do.
  const hasAmendments = useMemo(
    () => rows.some((r) => r.amendedEur != null),
    [rows],
  );

  const title = t("budget_dev_title");

  return (
    <>
      <Title description={t("budget_dev_description")}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="budget_link_label"
        sectionTo="/budget"
        currentKey="budget_dev_title"
        className="mt-5"
      />

      <section aria-label={title} className="my-4 space-y-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("budget_dev_intro")}
        </p>

        {stats?.yearsAvailable?.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {stats.yearsAvailable.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setFyParam(String(y))}
                className={cn(
                  "rounded border px-2 py-0.5 text-xs tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  y === fy
                    ? "border-primary bg-primary/10 text-primary font-semibold"
                    : "border-border hover:border-primary/60",
                )}
              >
                {y}
              </button>
            ))}
          </div>
        ) : null}

        {/* 1. THE COVERAGE, BEFORE ANY RANKING. */}
        {/* `coveredUnits`/`totalUnits` are NULL on the route's degraded
            sentinel, which also carries no `fiscalYear` — rendered, that is
            „ от  разпоредители са публикували отчет за  г." followed by a
            calendar claim about a year the payload never named. */}
        {!isLoading &&
        variance &&
        variance.coveredUnits != null &&
        variance.totalUnits != null &&
        variance.fiscalYear != null ? (
          <div
            className={cn(
              "rounded-xl border p-4 text-sm shadow-sm",
              variance.coveredUnits === 0 && yearHasClosed
                ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
                : "bg-card",
            )}
          >
            <p className="font-medium">
              {t("budget_dev_coverage", {
                covered: variance.coveredUnits,
                total: variance.totalUnits,
                fy: variance.fiscalYear,
                defaultValue: "",
              })}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {variance.coveredUnits > 0
                ? t("budget_dev_coverage_note")
                : yearHasClosed
                  ? t("budget_dev_coverage_none")
                  : t("budget_dev_coverage_pending")}
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="h-64 animate-pulse rounded-xl border bg-card" />
        ) : rows.length === 0 ? null : (
          <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">
                    {t("budget_dev_col_unit")}
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    {t("budget_dev_col_law")}
                  </th>
                  {hasAmendments ? (
                    <th className="px-4 py-2 text-right font-medium">
                      {t("budget_dev_col_amended")}
                    </th>
                  ) : null}
                  <th className="px-4 py-2 text-right font-medium">
                    {t("budget_dev_col_executed")}
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    {t("budget_dev_col_delta_law")}
                  </th>
                  {hasAmendments ? (
                    <th className="px-4 py-2 text-right font-medium">
                      {t("budget_dev_col_delta_amended")}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.nodeId} className="border-b last:border-b-0">
                    <td className="px-4 py-2">
                      <Link
                        to={`/budget/ministry/${r.nodeId}`}
                        className="text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring rounded"
                      >
                        {/* `||`, not `??`: an unmapped name is stored as the
                            empty string, which `??` sails past — the blank-row
                            defect from T6.4. */}
                        {(i18n.language === "bg"
                          ? r.nameBg || r.nameEn
                          : r.nameEn || r.nameBg) || r.nodeId}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.plannedEur == null ? "—" : formatEur(r.plannedEur)}
                    </td>
                    {hasAmendments ? (
                      <td className="px-4 py-2 text-right tabular-nums">
                        {r.amendedEur == null ? "—" : formatEur(r.amendedEur)}
                      </td>
                    ) : null}
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.executedEur == null ? "—" : formatEur(r.executedEur)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Delta value={r.deltaVsLawEur} />
                    </td>
                    {hasAmendments ? (
                      <td className="px-4 py-2 text-right">
                        {/* Suppressed rather than duplicated — see the note on
                            `hasAmendments`. */}
                        {r.amendedEur == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Delta value={r.deltaVsAmendedEur} />
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* The two deltas explained where they are read, not in a footnote. */}
        {rows.length > 0 ? (
          <p className="max-w-3xl text-xs text-muted-foreground">
            {hasAmendments
              ? t("budget_dev_delta_note")
              : t("budget_dev_delta_note_no_amendments")}
          </p>
        ) : null}

        <p className="text-[11px] text-muted-foreground/80">
          {t("budget_dev_source")}
        </p>
      </section>
    </>
  );
};
