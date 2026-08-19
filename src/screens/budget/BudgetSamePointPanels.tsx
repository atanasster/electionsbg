// „Сравнение спрямо същия период" — one horizontal bar per fiscal year, every
// year cut at the month the current one has reached.
//
// Plan: docs/plans/budget-hub-v1.md T9.3.
//
// BARS AS ELEMENTS, not a chart library, and that is the right call here rather
// than a concession: four panels of six bars each is a small-multiples table,
// and four `ResponsiveContainer`s would each measure themselves independently
// and disagree about their scales on the same row.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatEurSigned } from "@/lib/currency";
import type { SamePoint, SamePointSeries } from "./budgetSamePoint";

/** Bar width. Balances are negative in every year of this corpus, so the bar
 *  length is drawn from the MAGNITUDE while the label keeps the sign — a
 *  negative width renders as nothing at all. */
const widthPct = (value: number | null, max: number): string =>
  value == null || max === 0 ? "0%" : `${(Math.abs(value) / max) * 100}%`;

const Panel: FC<{ s: SamePointSeries; labelKey: string }> = ({
  s,
  labelKey,
}) => {
  const { t } = useTranslation();
  const max = Math.max(...s.rows.map((r) => Math.abs(r.value ?? 0)), 1);

  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="mb-2 text-xs font-semibold">{t(labelKey)}</div>
      <ul className="space-y-1.5">
        {s.rows.map((r) => {
          const pct =
            r.value != null && r.plan != null && r.plan !== 0
              ? (Math.abs(r.value) / Math.abs(r.plan)) * 100
              : null;
          return (
            <li key={r.fiscalYear} className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "w-9 shrink-0 tabular-nums",
                  r.isCurrent
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {r.fiscalYear}
              </span>
              <span className="h-2 flex-1 rounded bg-muted" aria-hidden>
                <span
                  className={cn(
                    "block h-2 rounded",
                    r.isCurrent ? "bg-primary" : "bg-primary/40",
                  )}
                  style={{ width: widthPct(r.value, max) }}
                />
              </span>
              {/* 28 not 24: `formatEurSigned` renders „−€1 914 405 872" —
                  15 characters — and a `shrink-0` span narrower than its
                  content overflows the row rather than wrapping. */}
              <span className="w-28 shrink-0 text-right tabular-nums">
                {r.value == null ? "—" : formatEurSigned(r.value)}
              </span>
              {/* „% of plan" is what neutralises nominal growth — without it a
                  reader is comparing 2021 levs-turned-euro against 2026 euro
                  and calling the difference performance. Absent on a year with
                  no adopted plan, which is FY2026's whole situation. */}
              {/* „от плана" — the label the legacy tile carried and this one
                  dropped. A bare „47%" beside a euro figure reads as a share
                  OF THAT FIGURE. */}
              <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
                {pct == null ? "" : `${pct.toFixed(0)}% ${t("budget_of_plan")}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export const BudgetSamePointPanels: FC<{
  data: SamePoint;
  /** series key → locale key, in render order. */
  labels: Record<string, string>;
  className?: string;
}> = ({ data, labels, className }) => {
  const { t, i18n } = useTranslation();

  // „края на юни", not „края на месец 6". The bundle's own
  // `budget_same_point_subtitle` already interpolates a month NAME, so a bare
  // number here would be the one place on the site that does not.
  // `timeZone: "UTC"` pairs with the `Date.UTC` above — without it the 1st-at-UTC-midnight
  // instant rolls back a month for every reader west of Greenwich, so „края на юни" printed
  // as „края на май".
  const monthName = new Date(
    Date.UTC(2020, data.month - 1, 1),
  ).toLocaleDateString(i18n.language === "bg" ? "bg-BG" : "en-GB", {
    month: "long",
    timeZone: "UTC",
  });

  return (
    <div className={className}>
      <p className="mb-2 text-xs text-muted-foreground">
        {t("budget_samepoint_intro", {
          month: monthName,
          fy: data.currentFiscalYear,
          defaultValue: "",
        })}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.series.map((s) => (
          <Panel key={s.series} s={s} labelKey={labels[s.series] ?? s.series} />
        ))}
      </div>
      {/* The verdict, per series and only where a median exists. Stated as a
          delta against the PRIOR years, never against „the average year" — the
          current year is excluded from its own comparison set. */}
      <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        {data.series
          .filter((s) => s.deltaPct != null || s.signMismatch)
          .map((s) => (
            <li key={s.series}>
              {s.deltaPct == null
                ? // A surplus year against deficit years. Saying WHY beats a
                  // silent gap that reads as missing data.
                  t("budget_samepoint_signmismatch", {
                    label: t(labels[s.series] ?? s.series),
                    defaultValue: "",
                  })
                : t("budget_samepoint_verdict", {
                    label: t(labels[s.series] ?? s.series),
                    delta: `${s.deltaPct >= 0 ? "+" : ""}${s.deltaPct.toFixed(0)}%`,
                    defaultValue: "",
                  })}
            </li>
          ))}
      </ul>
      <p className="mt-1 text-[11px] text-muted-foreground/80">
        {t("budget_samepoint_note")}
      </p>
    </div>
  );
};
