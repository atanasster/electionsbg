// /budget/personnel — how many people the state's administration employs.
//
// Plan: docs/plans/budget-hub-v1.md T6.9. Source: the Доклад за състоянието на
// администрацията, one row per year, 2017-2025.
//
// THE PAGE EXISTS TO KEEP TWO NUMBERS APART. The same document publishes:
//
//   * ЩАТНИ БРОЙКИ — budgeted posts. FY2025: 145 623 approved, 133 275 filled,
//     12 348 vacant.
//   * НСИ'S DECEMBER HEADCOUNT — persons employed, on НСИ's own methodology,
//     from a separate table. FY2025: 98 446.
//
// They differ by 34 829, and the difference means NOTHING: it is not „unfilled
// posts", which is 12 348 and published directly. A page that puts them in one
// column, or subtracts them, invents a finding. So they are rendered as two
// series with their bases named, and no arithmetic is done across them.
//
// `payrollEur` is NULL on every row — the Доклад publishes no payroll — so
// there is no money on this page at all. Rendering it as €0 would be a claim
// that the administration costs nothing.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { cn } from "@/lib/utils";
import { formatEurCompact } from "@/lib/currency";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { useBudgetPersonnel } from "@/data/budget/useBudgetPersonnel";

const num = (v: number | null): string =>
  v == null ? "—" : new Intl.NumberFormat("bg-BG").format(v);

export const BudgetPersonnelScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  // ONE locale for money, like the hub. Omitted, /en renders „€279 млн."
  // beside English labels — a defect this module has already shipped once.
  const moneyLocale = bg ? "bg-BG" : "en-GB";
  const { personnel, isLoading } = useBudgetPersonnel();

  const points = useMemo(() => personnel?.points ?? [], [personnel]);
  const latest = points.length ? points[points.length - 1] : null;

  /** Vacancy as a share of the ESTABLISHMENT — the one derived figure the
   *  source supports, because both terms come from the same table. */
  const units = personnel?.units ?? [];
  const cov = personnel?.unitsCoverage ?? null;
  /** The coverage sentence, or NULL when it cannot be stated honestly. It is
   *  built here rather than inline because the SHARE needs both halves: with
   *  no §II figure there is no denominator, and a leaderboard captioned „7
   *  ministries" without one reads as „the 7 that matter". */
  const coverageLine =
    cov && cov.unitsExpenditureEur != null && cov.stateExpenditureEur
      ? t("budget_staff_units_coverage", {
          units: cov.units,
          fy: personnel?.unitsFiscalYear ?? "",
          unitsEur: formatEurCompact(cov.unitsExpenditureEur, moneyLocale),
          stateEur: formatEurCompact(cov.stateExpenditureEur, moneyLocale),
          pct: (
            (cov.unitsExpenditureEur / cov.stateExpenditureEur) *
            100
          ).toFixed(1),
          defaultValue: "",
        })
      : null;

  const vacancyPct =
    latest?.positionsVacant != null &&
    latest?.positionsTotal != null &&
    latest.positionsTotal !== 0
      ? (latest.positionsVacant / latest.positionsTotal) * 100
      : null;

  // A tight floor, not zero. The establishment moves within a few percent
  // across nine years, so bars scaled from 0 render 95.8%-100% — nine
  // indistinguishable full bars conveying nothing. The sibling
  // `BudgetPersonnelTile` fixed exactly this the same way. The floor is stated
  // beneath the chart, because a non-zero baseline exaggerates change and a
  // reader must be told the axis does not start at zero.
  const { peak, floor } = useMemo(() => {
    const vals = points.map((p) => p.positionsTotal ?? 0).filter((v) => v > 0);
    if (!vals.length) return { peak: 1, floor: 0 };
    const hi = Math.max(...vals);
    const lo = Math.min(...vals);
    // 5% of the range below the minimum, so the smallest year is visible
    // rather than a zero-width sliver.
    const pad = Math.max((hi - lo) * 0.25, hi * 0.01);
    return { peak: hi, floor: Math.max(0, lo - pad) };
  }, [points]);

  const title = t("budget_staff_title");

  return (
    <>
      <Title description={t("budget_staff_description")}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="budget_link_label"
        sectionTo="/budget"
        currentKey="budget_staff_title"
        className="mt-5"
      />

      <section aria-label={title} className="my-4 space-y-6">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("budget_staff_intro")}
        </p>

        {isLoading ? (
          <div className="h-72 animate-pulse rounded-xl border bg-card" />
        ) : points.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("budget_staff_empty")}
          </p>
        ) : (
          <>
            {/* 1. The latest year, as three numbers from ONE table. */}
            {latest ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  {
                    k: "budget_staff_total",
                    v: latest.positionsTotal,
                  },
                  {
                    k: "budget_staff_filled",
                    v: latest.positionsFilled,
                  },
                  {
                    k: "budget_staff_vacant",
                    v: latest.positionsVacant,
                  },
                ].map((c) => (
                  <div
                    key={c.k}
                    className="rounded-xl border bg-card p-4 shadow-sm"
                  >
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t(c.k)}
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums">
                      {num(c.v)}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            {/* T9.8 — WHERE those posts are. „145 623 щатни бройки" without
                this is a number nobody can place: 74% of it is central and the
                municipal slice is a PART of the territorial one, not a peer. */}
            {latest?.positionsCentral != null ? (
              <div>
                <h2 className="mb-2 text-sm font-semibold">
                  {t("budget_staff_split_h")}
                </h2>
                <ul className="divide-y rounded-xl border bg-card shadow-sm">
                  {[
                    {
                      k: "budget_staff_central",
                      v: latest.positionsCentral,
                      indent: false,
                    },
                    {
                      k: "budget_staff_territorial",
                      v: latest.positionsTerritorial,
                      indent: false,
                    },
                    {
                      k: "budget_staff_municipal",
                      v: latest.positionsMunicipal,
                      indent: true,
                    },
                    {
                      k: "budget_staff_municipal_own",
                      v: latest.positionsMunicipalOwnRevenue,
                      indent: true,
                    },
                  ]
                    .filter((r) => r.v != null)
                    .map((r) => (
                      <li
                        key={r.k}
                        className={cn(
                          "flex items-baseline justify-between gap-3 px-4 py-2 text-sm",
                          // The subsets are INDENTED and muted, because a flat
                          // list of four invites adding them up.
                          r.indent && "pl-8 text-muted-foreground",
                        )}
                      >
                        <span>{t(r.k)}</span>
                        <span className="shrink-0 tabular-nums">
                          {num(r.v)}
                        </span>
                      </li>
                    ))}
                </ul>
                <p className="mt-1 text-[11px] text-muted-foreground/80">
                  {t("budget_staff_split_note")}
                </p>
              </div>
            ) : null}

            {vacancyPct != null && latest ? (
              <p className="text-sm">
                {t("budget_staff_vacancy_rate", {
                  pct: vacancyPct.toFixed(1),
                  fy: latest.fiscalYear,
                  defaultValue: "",
                })}
              </p>
            ) : null}

            {/* Two facts the Доклад publishes that a headcount alone hides:
                how LONG the vacancies have been open, and how many separate
                bodies the establishment is spread across. */}
            {latest?.positionsVacantOverSixMonths != null &&
            latest.positionsVacant != null ? (
              <p className="text-sm">
                {t("budget_staff_vacant_long", {
                  n: num(latest.positionsVacantOverSixMonths),
                  total: num(latest.positionsVacant),
                  defaultValue: "",
                })}
              </p>
            ) : null}
            {/* `structuresTotal` is summed server-side so it is NULL when
                either half is — 2017-2020 publish none, and „0 структури"
                would be a claim about a state that has none. */}
            {latest?.structuresTotal != null ? (
              <p className="text-sm text-muted-foreground">
                {t("budget_staff_structures", {
                  total: num(latest.structuresTotal),
                  central: num(latest.structuresCentral),
                  territorial: num(latest.structuresTerritorial),
                  defaultValue: "",
                })}
              </p>
            ) : null}

            {/* 2. The trend, posts only — one series, one basis. */}
            <div>
              <h2 className="mb-2 text-sm font-semibold">
                {t("budget_staff_trend_h")}
              </h2>
              <ul className="space-y-1 rounded-xl border bg-card p-4 shadow-sm">
                {points.map((p) => (
                  <li
                    key={p.fiscalYear}
                    className="flex items-center gap-3 text-sm"
                  >
                    <span className="w-12 shrink-0 tabular-nums text-muted-foreground">
                      {p.fiscalYear}
                    </span>
                    <span
                      className="h-2 flex-1 rounded bg-primary/15"
                      aria-hidden
                    >
                      <span
                        className="block h-2 rounded bg-primary"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(
                              0,
                              (((p.positionsTotal ?? 0) - floor) /
                                Math.max(1, peak - floor)) *
                                100,
                            ),
                          )}%`,
                        }}
                      />
                    </span>
                    <span className="w-24 shrink-0 text-right tabular-nums">
                      {num(p.positionsTotal)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-muted-foreground/80">
                {personnel?.positionsBasis ?? ""}
                {floor > 0 ? ` · ${t("budget_staff_axis_note")}` : ""}
              </p>
            </div>

            {/* 3. НСИ'S SERIES, SEPARATELY — never in the same column, never
                   subtracted from the one above. */}
            <div>
              <h2 className="mb-1 text-sm font-semibold">
                {t("budget_staff_nsi_h")}
              </h2>
              <p className="mb-2 max-w-3xl rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/30">
                {t("budget_staff_nsi_note")}
              </p>
              <ul className="divide-y rounded-xl border bg-card shadow-sm">
                {points
                  .filter((p) => p.nsiHeadcount != null)
                  .map((p) => (
                    <li
                      key={p.fiscalYear}
                      className="flex items-baseline justify-between gap-3 px-4 py-1.5 text-sm"
                    >
                      <span className="tabular-nums text-muted-foreground">
                        {p.fiscalYear}
                      </span>
                      <span className="tabular-nums">
                        {num(p.nsiHeadcount)}
                      </span>
                    </li>
                  ))}
              </ul>
              <p className="mt-1 text-[11px] text-muted-foreground/80">
                {personnel?.headcountBasis ?? ""}
              </p>
            </div>

            {/* 4. THE PER-MINISTRY LEADERBOARD (T9.8) — a THIRD publisher, and
                   the one most easily mistaken for the two above. It counts
                   EXECUTED FTE inside one ministry from that ministry's own
                   programme-budget report; the national series counts щатни
                   бройки across the whole administration. They are never summed
                   and never compared, which is why this sits below the НСИ
                   block rather than beside the headline cards.

                   THE COVERAGE LINE IS NOT OPTIONAL. Seven ministries out of
                   ~48 first-level units is a fragment, and a leaderboard reads
                   as a ranking of everything unless it says otherwise. */}
            <div>
              <h2 className="mb-1 text-sm font-semibold">
                {t("budget_staff_units_h")}
              </h2>
              {units.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("budget_staff_units_empty")}
                </p>
              ) : (
                <>
                  {coverageLine ? (
                    <p className="mb-2 max-w-3xl rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/30">
                      {coverageLine}
                    </p>
                  ) : null}
                  <ul className="divide-y rounded-xl border bg-card shadow-sm">
                    {units.map((u) => (
                      <li
                        key={u.nodeId}
                        className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {(bg ? u.nameBg : u.nameEn) || u.nameBg || u.nodeId}
                        </span>
                        <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                          {num(u.headcount)}{" "}
                          <span className="text-[10px]">
                            {t("budget_staff_units_col_headcount")}
                          </span>
                        </span>
                        <span className="w-24 shrink-0 text-right tabular-nums">
                          {u.personnelEur == null
                            ? "—"
                            : formatEurCompact(u.personnelEur, moneyLocale)}
                        </span>
                        <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
                          {u.avgCostPerFteEur == null
                            ? "—"
                            : `${formatEurCompact(u.avgCostPerFteEur, moneyLocale)}/${t("budget_staff_units_col_avg")}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {/* The LOCALISED basis, not the payload's. `unitBasis` comes
                      from SQL and is Bulgarian-only, so /en was showing a
                      Bulgarian caption under an English table. */}
                  <p className="mt-1 text-[11px] text-muted-foreground/80">
                    {t("budget_staff_units_basis")}
                  </p>
                </>
              )}
            </div>
          </>
        )}

        <p
          className={cn(
            "text-[11px] text-muted-foreground/80",
            points.length === 0 && "mt-2",
          )}
        >
          {t("budget_staff_source")}
        </p>
      </section>
    </>
  );
};
