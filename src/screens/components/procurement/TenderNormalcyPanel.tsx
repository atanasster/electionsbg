// "Колко типична е тази поръчка?" — the cohort-distribution panel on the tender
// (procedure) detail page. The ex-ante companion to the contract-stage panel
// (ContractNormalcyPanel): positions this tender on a percentile ruler against a
// cohort of similar tenders (same adaptive CPV prefix × era) on estimated value,
// the submission window (publication → deadline — the rushed-deadline signal),
// and procedure type. DESCRIPTIVE, not a verdict of wrongdoing. See migration 067.

import { FC, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  CalendarClock,
  Euro,
  FileText,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import { useTenderNormalcy } from "@/data/procurement/useTenderNormalcy";
import {
  normalcyVerdict,
  procedureEvaluable,
  procedureIsDeviation,
  NORMALCY_MIN_N,
} from "@/lib/normalcy";
import { formatEurCompact, formatPct, formatInt } from "@/lib/currency";
import {
  procedureLabel,
  cpvDivisionName,
  type ProcedureBucket,
} from "@/lib/cpvSectors";
import { Strip, Chip, MetricRow, FLAG_CLS, AMBER_ZONE } from "./normalcyStrip";

export const TenderNormalcyPanel: FC<{ unp?: string | null }> = ({ unp }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useTenderNormalcy(unp);
  if (!data || !data.cohort) return null;

  // Deviation summary — only risk-directional metrics count (window + procedure);
  // the neutral `value` can never deviate, so it is excluded from BOTH numerator
  // and denominator (mirrors normalcyDeviationSummary for contracts).
  const windowVerdict = data.window
    ? normalcyVerdict(data.window.percentile, "low", data.window.n)
    : null;
  let deviations = 0;
  let evaluated = 0;
  if (windowVerdict && windowVerdict.level !== "insufficient") {
    evaluated += 1;
    if (windowVerdict.isRiskDeviation) deviations += 1;
  }
  if (data.procedure && procedureEvaluable(data.procedure)) {
    evaluated += 1;
    if (procedureIsDeviation(data.procedure)) deviations += 1;
  }

  // A neutral metric (value) is never a "deviation" — positioned, not judged.
  // Five tiers so a strong outlier reads as "много по-висока".
  const neutralLabel = (p: number, n: number): string => {
    if (n < NORMALCY_MIN_N) return bg ? "малка извадка" : "small sample";
    if (p >= 0.9) return bg ? "много по-висока" : "much higher";
    if (p > 0.75) return bg ? "по-висока" : "higher";
    if (p <= 0.1) return bg ? "много по-ниска" : "much lower";
    if (p < 0.25) return bg ? "по-ниска" : "lower";
    return bg ? "в нормите" : "in range";
  };

  const median = (label: ReactNode) => (
    <>
      {bg ? "медиана" : "median"} {label}
    </>
  );
  const daysWord = (n: number) =>
    bg ? (n === 1 ? "ден" : "дни") : n === 1 ? "day" : "days";

  const cohort = data.cohort;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4 text-indigo-600" />
            {bg
              ? "Колко типична е тази поръчка?"
              : "How typical is this tender?"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {bg ? "Сравнено с" : "Compared with"} {formatInt(cohort.n, lang)}{" "}
            {bg ? "сходни" : "similar"} ·{" "}
            {cpvDivisionName(cohort.cpvPrefix, lang)} (CPV {cohort.cpvPrefix}) ·{" "}
            {cohort.yearFrom}
            {cohort.yearTo !== cohort.yearFrom ? `–${cohort.yearTo}` : ""}
          </p>
          {/* Cohort context — informative, not a deviation. */}
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {formatPct(cohort.cancelledShare, lang, 0)}{" "}
            {bg ? "отменени" : "cancelled"} ·{" "}
            {formatPct(cohort.euFundedShare, lang, 0)}{" "}
            {bg ? "с ЕС финансиране" : "EU-funded"}
          </p>
        </div>
        {evaluated > 0
          ? (() => {
              const tip =
                deviations > 0
                  ? bg
                    ? `${deviations} от ${evaluated} показателя за конкуренция се отклоняват`
                    : `${deviations} of ${evaluated} competition indicators deviate`
                  : bg
                    ? "Без сигнали за по-слаба конкуренция"
                    : "No weaker-competition signals";
              return (
                <span
                  title={tip}
                  aria-label={tip}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${
                    deviations > 0
                      ? FLAG_CLS
                      : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  }`}
                >
                  {deviations > 0 ? (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {deviations}
                    </>
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  )}
                </span>
              );
            })()
          : null}
      </div>

      {!cohort.sufficient ? (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
          {bg
            ? "Малко сходни поръчки — сравнението е ориентировъчно."
            : "Few similar tenders — treat the comparison as indicative."}
        </p>
      ) : null}

      <div className="mt-2 divide-y">
        {data.value
          ? (() => {
              const p = data.value.percentile;
              return (
                <MetricRow
                  icon={<Euro className="h-3.5 w-3.5" />}
                  label={bg ? "Прогнозна стойност" : "Estimated value"}
                  value={formatEurCompact(data.value.value, lang)}
                  sub={
                    <>
                      {median(formatEurCompact(data.value.median, lang))} ·{" "}
                      {Math.round(p * 100)}
                      {bg ? "-и персентил" : "th pct"}
                    </>
                  }
                  strip={<Strip percentile={p} dir="neutral" risk={false} />}
                  chip={<Chip label={neutralLabel(p, data.value.n)} />}
                  pctTitle={`${Math.round(p * 100)}${bg ? "-и персентил" : "th percentile"}`}
                />
              );
            })()
          : null}

        {data.window && windowVerdict
          ? (() => {
              const v = windowVerdict;
              const label =
                v.level === "insufficient"
                  ? bg
                    ? "малка извадка"
                    : "small sample"
                  : v.isRiskDeviation
                    ? bg
                      ? "Необичайно"
                      : "Unusual"
                    : bg
                      ? "Типично"
                      : "Typical";
              return (
                <MetricRow
                  icon={<CalendarClock className="h-3.5 w-3.5" />}
                  label={bg ? "Срок за оферти" : "Submission window"}
                  value={`${formatInt(data.window.value, lang)} ${daysWord(data.window.value)}`}
                  sub={median(
                    `${formatInt(Math.round(data.window.median), lang)} ${daysWord(Math.round(data.window.median))}`,
                  )}
                  strip={
                    <Strip
                      percentile={data.window.percentile}
                      dir="low"
                      risk={v.isRiskDeviation}
                    />
                  }
                  chip={<Chip label={label} flag={v.isRiskDeviation} />}
                  pctTitle={
                    bg
                      ? `Под 14 дни при ${formatPct(data.window.shortShare, lang, 0)} от сходните`
                      : `Under 14 days in ${formatPct(data.window.shortShare, lang, 0)} of similar`
                  }
                />
              );
            })()
          : null}

        {data.procedure && procedureEvaluable(data.procedure)
          ? (() => {
              const flag = procedureIsDeviation(data.procedure);
              return (
                <MetricRow
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label={bg ? "Вид процедура" : "Procedure"}
                  value={procedureLabel(
                    data.procedure.bucket as ProcedureBucket,
                    lang,
                  )}
                  strip={
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${Math.round(data.procedure.openShare * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                        {formatPct(data.procedure.openShare, lang, 0)}{" "}
                        {bg ? "открити" : "open"}
                      </span>
                    </div>
                  }
                  chip={
                    <Chip
                      label={
                        flag
                          ? bg
                            ? "Необичайно"
                            : "Unusual"
                          : bg
                            ? "Типично"
                            : "Typical"
                      }
                      flag={flag}
                    />
                  }
                />
              );
            })()
          : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-2 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-5 rounded"
              style={{ background: "hsl(var(--primary) / 0.18)" }}
            />
            {bg ? "обичайни стойности" : "usual range"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-5 rounded"
              style={{ background: AMBER_ZONE }}
            />
            {bg ? "по-кратък срок" : "shorter window"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: "hsl(var(--primary))" }}
            />
            {bg ? "тази поръчка" : "this tender"}
          </span>
        </div>
        <Link
          to={`/procurement/tenders?cpv=${encodeURIComponent(cohort.cpvPrefix)}&pscope=all`}
          className="text-primary hover:underline"
        >
          {bg ? "Виж сходни поръчки" : "Browse similar"}
        </Link>
      </div>
    </section>
  );
};
