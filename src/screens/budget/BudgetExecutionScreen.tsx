// /budget/execution — plan against outturn, for the budget as a whole.
//
// Plan: docs/plans/budget-hub-v1.md T6.7. The sibling money pages ask what the
// money WAS; this one asks whether the year went as the law said it would.
//
// THE PAGE IS BUILT AROUND ONE IDENTITY, because showing its terms without it
// turns one fact into four unrelated ones:
//
//     приходи − разходи − вноска в ЕС = салдо
//     22 263 692 630 − 24 775 124 952 − 814 052 657 = −3 325 484 979   (FY2024)
//
// Two consequences that are easy to get wrong:
//
//   * `financing` IS `-balance`. They agree to within €10 651 across every year
//     in the corpus (worst case FY2025, 3.4e-6 of the figure) — a rounding
//     residue, not a finding. NOTE this is the FINANCING residue; the identity
//     above closes to €1 or better everywhere. Rendered side by side as two rows the
//     page appears to report two independent figures that happen to mirror; it
//     is one figure with its sign flipped, and the copy says so.
//   * THE EU CONTRIBUTION IS A SEPARATE TERM. Folding it into expenditure makes
//     the identity close and quietly restates §II as €25.6bn, which is not a
//     number the Ministry publishes anywhere.
//
// AN OPEN YEAR HAS NO PLAN, AND DOES HAVE A PROJECTION. FY2026's `planned` is
// NULL on all five series — the year runs on an interim law — while `projected`
// is populated (basis 2025). The default `?fy` IS that year, so comparing
// against `planned` alone renders the plan and difference columns as two full
// columns of em dashes under a banner about the difference from plan. The
// comparator is therefore planned-or-projected, and the column says which.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { formatEur, formatEurSigned } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import {
  useBudgetYear,
  type BudgetSeriesKey,
  type BudgetFigure,
} from "@/data/budget/useBudgetYear";
import { useBudgetHubStats } from "@/data/budget/useBudgetHubStats";
import { useBudgetSeries } from "@/data/budget/useBudgetSeries";
import { BudgetTrendChart } from "./BudgetTrendChart";

/** The identity's terms, in the order they appear in it. `financing` is
 *  deliberately absent — it is `-balance` and gets its own note. */
const TERMS: { key: BudgetSeriesKey; labelKey: string; sign: 1 | -1 }[] = [
  { key: "revenue", labelKey: "budget_exec_revenue", sign: 1 },
  { key: "expenditure", labelKey: "budget_exec_expenditure", sign: -1 },
  { key: "euContribution", labelKey: "budget_exec_eu", sign: -1 },
];

const pct = (a: number | null, b: number | null): number | null =>
  a == null || b == null || b === 0 ? null : (a / b) * 100;

export const BudgetExecutionScreen: FC = () => {
  const { t } = useTranslation();
  const [fyParam, setFyParam] = useSearchParam("fy", { replace: true });
  const { stats } = useBudgetHubStats();
  const fy =
    fyParam && /^\d{4}$/.test(fyParam)
      ? Number(fyParam)
      : (stats?.fiscalYear ?? null);

  const { year, isLoading } = useBudgetYear(fy);
  const figures = year?.figures ?? null;
  const balance = figures?.balance ?? null;

  /** Does the published balance actually equal the terms above it? If the
   *  corpus ever stops closing, the page must not draw a sum that disagrees
   *  with the figure printed beneath it. */
  const identityHolds = useMemo(() => {
    if (!figures || balance?.actual == null) return null;
    const sum = TERMS.reduce<number | null>((acc, term) => {
      const v = figures[term.key]?.actual;
      return acc == null || v == null ? null : acc + term.sign * v;
    }, 0);
    if (sum == null) return null;
    // The corpus closes EXACTLY: measured across all 12 (year, basis) pairs the
    // residue is 0 on eleven and −1 on 2023 `planned`. €1 000 leaves room for
    // future rounding while still catching a dropped term, the smallest of
    // which is €560m. (The often-quoted €5 003 is the FINANCING residue, a
    // different quantity — see the note below the table.)
    return Math.abs(sum - balance.actual) < 1_000;
  }, [figures, balance]);

  const gdp = year?.gdpEur ?? null;

  // An open year is compared against its PROJECTION, a closed one against the
  // law. Which of the two is in the column is stated in its heading, never
  // inferred by the reader from the year they happen to be looking at.
  const usesProjection =
    figures != null &&
    (Object.keys(figures) as BudgetSeriesKey[]).every(
      (k) => figures[k]?.planned == null,
    ) &&
    (Object.keys(figures) as BudgetSeriesKey[]).some(
      (k) => figures[k]?.projected != null,
    );
  const comparator = (f: BudgetFigure | null | undefined): number | null =>
    usesProjection ? (f?.projected ?? null) : (f?.planned ?? null);
  // A FULL-YEAR figure over full-year GDP, or nothing. For a closed year that
  // is the outturn; for an open one the projection; a part-year balance is
  // never divided by a full-year denominator.
  const gdpRatio = useMemo(() => {
    if (!gdp) return null;
    if (year?.complete === true) return pct(balance?.actual ?? null, gdp);
    return pct(balance?.projected ?? null, gdp);
  }, [gdp, year, balance]);

  // EVERY series, one read — the trend needs revenue, expenditure and the
  // balance drawn together, and the projection also reads the EU contribution.
  const { series: allSeries } = useBudgetSeries(null);

  /** The window this page draws: the selected fiscal year, month by month.
   *  The projection anchors on the PRIOR year, so the chart is handed the whole
   *  corpus separately rather than being asked to project from what it draws. */
  const trendPoints = useMemo(
    () => (allSeries?.points ?? []).filter((p) => p.fiscalYear === fy),
    [allSeries, fy],
  );
  /** PERIODS, not rows. Each period carries five series rows, so a row count
   *  clears any `> 1` threshold on a single month — and the chart itself bails
   *  on fewer than two periods, so the heading rendered over an empty box. */
  const trendMonths = useMemo(
    () => new Set(trendPoints.map((p) => p.period)).size,
    [trendPoints],
  );

  const band = stats?.peerBands?.B9 ?? null;

  /** The Maastricht verdict, on the ONE basis the 3% ceiling is defined for:
   *  general-government net lending (ESA B.9), which is what `band` carries.
   *  Never computed from the KFP cash ratio above it — see the render site.
   *
   *  A SURPLUS gets no badge. „within the ceiling" over a positive balance is
   *  technically true and reads as faint praise for what is unambiguously good
   *  news; the legacy tile suppressed it the same way (`v.value < 0`).
   *
   *  The `v == null` arm is UNREACHABLE through the current render path — the
   *  JSX guards on `band?.bgPctGdp != null` before this value is read, and a
   *  mutation that turns this arm into `{ over: false }` leaves every test
   *  green. It stays anyway, and it is not the tautology it looks like:
   *  `null >= 0` is TRUE in JavaScript, so a missing figure would be caught by
   *  the second arm — but `undefined >= 0` is FALSE, so an ABSENT band would
   *  fall through to `{ over: undefined < -3 }` = „within". That is the one
   *  wrong answer this whole step exists to prevent, so the explicit check
   *  earns its place as the guard that survives the JSX being refactored. */
  const maastricht = useMemo(() => {
    const v = band?.bgPctGdp;
    if (v == null || v >= 0) return null;
    return { over: v < -3 };
  }, [band]);

  const title = t("budget_exec_title");

  const Row: FC<{
    labelKey: string;
    fig: BudgetFigure | null;
    sign?: 1 | -1;
  }> = ({ labelKey, fig, sign = 1 }) => {
    const base = comparator(fig);
    // On an OPEN year the outturn covers part of the year and the comparator
    // covers all of it, so their difference is not a shortfall — subtracting
    // them printed „−€14 495 911 100" against revenue at the half-year, which
    // reads as a €14.5bn collapse. The fourth column becomes a SHARE there:
    // how much of the year's projection has been realised so far.
    const delta =
      !usesProjection && fig?.actual != null && base != null
        ? fig.actual - base
        : null;
    const share =
      usesProjection && fig?.actual != null && base != null && base !== 0
        ? (fig.actual / base) * 100
        : null;
    return (
      <tr className="border-b last:border-b-0">
        <td className="px-4 py-2 text-sm">
          {sign === -1 ? <span aria-hidden>− </span> : null}
          {t(labelKey)}
        </td>
        <td className="px-4 py-2 text-right text-sm tabular-nums">
          {base == null ? "—" : formatEur(base)}
        </td>
        <td className="px-4 py-2 text-right text-sm tabular-nums font-medium">
          {fig?.actual == null ? "—" : formatEur(fig.actual)}
        </td>
        <td className="px-4 py-2 text-right text-sm tabular-nums">
          {usesProjection
            ? share == null
              ? "—"
              : `${share.toFixed(1)}%`
            : delta == null
              ? "—"
              : formatEurSigned(delta, undefined, { plusForPositive: true })}
        </td>
      </tr>
    );
  };

  return (
    <>
      <Title description={t("budget_exec_description")}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="budget_link_label"
        sectionTo="/budget"
        currentKey="budget_exec_title"
        className="mt-5"
      />

      <section aria-label={title} className="my-4 space-y-6">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("budget_exec_intro")}
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

        {/* An unfinished year is reported to date, and its „outturn" is not one.
            Without this the plan column looks massively over-shot every time a
            reader lands on the current year. */}
        {year && year.complete === false ? (
          <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
            {t(
              usesProjection
                ? "budget_exec_partial_projection"
                : "budget_exec_partial",
              { asOf: year.asOf ?? "", defaultValue: "" },
            )}
          </p>
        ) : null}

        {isLoading ? (
          <div className="h-64 animate-pulse rounded-xl border bg-card" />
        ) : !figures ? (
          <p className="text-sm text-muted-foreground">
            {t("budget_exec_empty")}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
              <table className="w-full min-w-[38rem]">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">
                      {t("budget_exec_col_item")}
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      {usesProjection
                        ? t("budget_exec_col_projected")
                        : t("budget_exec_col_plan")}
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      {t("budget_exec_col_actual")}
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      {usesProjection
                        ? t("budget_exec_col_share")
                        : t("budget_exec_col_delta")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TERMS.map((term) => (
                    <Row
                      key={term.key}
                      labelKey={term.labelKey}
                      fig={figures[term.key] ?? null}
                      sign={term.sign}
                    />
                  ))}
                  <tr className="border-t-2 bg-muted/40">
                    <td className="px-4 py-2 text-sm font-semibold">
                      {t("budget_exec_balance")}
                    </td>
                    <td className="px-4 py-2 text-right text-sm tabular-nums">
                      {/* Signed: a deficit'"'"'s minus belongs in FRONT of the
                          symbol, not between it and the digits. */}
                      {comparator(balance) == null
                        ? "—"
                        : formatEurSigned(comparator(balance)!)}
                    </td>
                    <td className="px-4 py-2 text-right text-sm font-bold tabular-nums">
                      {balance?.actual == null
                        ? "—"
                        : formatEurSigned(balance.actual)}
                    </td>
                    <td className="px-4 py-2 text-right text-sm tabular-nums">
                      {balance?.actual == null || comparator(balance) == null
                        ? "—"
                        : usesProjection
                          ? `${((balance.actual / comparator(balance)!) * 100).toFixed(1)}%`
                          : formatEurSigned(
                              balance.actual - comparator(balance)!,
                              undefined,
                              { plusForPositive: true },
                            )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* HOW THE YEAR MOVED, not just where it ended. The table above is
                one row per term at one instant; this is the same four terms
                month by month, with the dashed tail on a year that has not
                finished. T9.2 — the pre-migration screen led with it and the
                hub migration shipped fourteen pages carrying no chart at all. */}
            {trendMonths > 1 ? (
              <div className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
                <h2 className="mb-1 text-sm font-semibold">
                  {t("budget_trend_h")}
                </h2>
                <BudgetTrendChart
                  points={trendPoints}
                  allPoints={allSeries?.points ?? []}
                />
              </div>
            ) : null}

            {/* The identity, stated — and only claimed when it actually holds. */}
            <p className="max-w-3xl text-xs text-muted-foreground">
              {identityHolds === true
                ? t("budget_exec_identity")
                : t("budget_exec_identity_broken")}
            </p>

            {/* Financing is the balance with its sign flipped. Two rows without
                this note read as two findings. */}
            {figures.financing?.actual != null ? (
              <p className="max-w-3xl text-xs text-muted-foreground">
                {t("budget_exec_financing_note", {
                  amount: formatEur(Math.abs(figures.financing.actual)),
                  defaultValue: "",
                })}
              </p>
            ) : null}

            {/* The deficit against GDP, which is how it is actually discussed —
                and the only basis on which the EU comparison below means
                anything. */}
            {/* NEVER a part-year ratio. On the default year the outturn is six
                months and the GDP is twelve, so `actual/gdp` prints −1.5% four
                lines above „ЕС −3.1%" — and the corpus's own annual answer is
                −2.7%. An open year shows its PROJECTION, labelled; a year with
                neither shows no ratio at all. */}
            {gdpRatio != null && gdp ? (
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <h2 className="text-sm font-semibold">
                  {t("budget_exec_gdp_h")}
                </h2>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {gdpRatio.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(
                    usesProjection
                      ? "budget_exec_gdp_note_projected"
                      : "budget_exec_gdp_note",
                    { gdp: formatEur(gdp), defaultValue: "" },
                  )}
                </p>
                {/* `bgPctGdp` present, not merely `band` — with the row loaded
                    and the figure NULL this sentence rendered „България е на
                    % от БВП", measured. */}
                {band?.bgPctGdp != null ? (
                  <>
                    <p className="mt-2 text-sm tabular-nums">
                      {t("budget_exec_eu_body", {
                        bg: band.bgPctGdp?.toFixed(1),
                        eu: band.euAvgPctGdp?.toFixed(1),
                        rank: band.rank,
                        total: band.total,
                        year: band.year,
                        defaultValue: "",
                      })}
                    </p>
                    {/* ⚠️ THE BADGE BELONGS TO THE EUROSTAT LINE, NOT TO THE
                        CASH RATIO ABOVE IT — and that is a correction, not a
                        placement preference. The 3% ceiling is defined on
                        general-government net lending (ESA B.9), which is the
                        figure `band` carries; the number above is the state
                        budget's KFP cash balance, a narrower perimeter the
                        rule does not govern.

                        The pre-migration screen badged the CASH ratio, and the
                        two disagree about the VERDICT — not merely about the
                        number — in three of the six selectable years. FY2025 is
                        the cleanest case, because it is also the band's own
                        year, so the „different year" half of the disclaimer
                        below does not apply and the opposite verdict comes from
                        PERIMETER alone: cash −2.68% (inside) against Eurostat
                        −3.5% (outside). Both numbers are correct; the badge was
                        attached to the wrong one. */}
                    {/* The label NAMES its basis. Without that the badge reads
                        „above 3% of GDP" three lines under a headline of
                        −2.7% of GDP, and the sentence that resolves the two
                        sits BELOW it. */}
                    {maastricht ? (
                      <p className="mt-1.5 text-[11px]">
                        <span
                          className={cn(
                            "inline-block rounded px-1.5 py-0.5",
                            maastricht.over
                              ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
                          )}
                        >
                          {t(
                            maastricht.over
                              ? "budget_maastricht_over_eurostat"
                              : "budget_maastricht_under_eurostat",
                          )}
                        </span>
                      </p>
                    ) : null}
                    {/* Two different perimeters AND two different years — the
                        state budget's cash balance above, Eurostat's whole
                        general-government net lending here. */}
                    <p className="mt-1 text-[11px] text-muted-foreground/80">
                      {t("budget_exec_eu_basis")}
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {t("budget_exec_source")}
        </p>
      </section>
    </>
  );
};
