// "Колко типична е тази поръчка?" — the cohort-distribution panel on the
// contract detail page. For each metric it positions this contract on a
// percentile ruler against a cohort of similar procurements (same CPV, era),
// with a neutral positional verdict. DESCRIPTIVE, not a verdict of wrongdoing —
// the companion to the per-contract CRI badges. See migration 063.

import { FC, ReactNode, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BarChart3, Users, Euro, FileText, PieChart, Info } from "lucide-react";
import {
  useContractNormalcy,
  type NormalcyDir,
} from "@/data/procurement/useContractNormalcy";
import {
  normalcyVerdict,
  normalcyDeviationSummary,
  procedureEvaluable,
  procedureIsDeviation,
  type NormalcyLevel,
} from "@/lib/normalcy";
import { formatEurCompact, formatPct, formatInt } from "@/lib/currency";
import { procedureLabel, type ProcedureBucket } from "@/lib/cpvSectors";

// Percentile ruler: fixed bands (IQR 0.25–0.75, whiskers 0.10–0.90, median 0.5)
// with the contract's dot at its true cohort percentile. A ruler, not a value
// axis — so a heavy-tailed distribution never squishes the bands; the absolute
// value + median are shown in text beside it. CSS-positioned (not SVG) so the
// marker stays a true circle at any container width.
const pct = (p: number) => `${(Math.max(0, Math.min(1, p)) * 100).toFixed(2)}%`;

const Strip: FC<{ percentile: number; dir: NormalcyDir; risk: boolean }> = ({
  percentile,
  dir,
  risk,
}) => (
  <div className="relative h-5 w-full">
    {dir !== "neutral" ? (
      <div
        className="absolute top-1/2 h-3.5 -translate-y-1/2 rounded-sm"
        style={{
          left: dir === "low" ? 0 : pct(0.9),
          width: pct(0.1),
          background: "hsl(var(--destructive) / 0.09)",
        }}
      />
    ) : null}
    <div
      className="absolute top-1/2 h-px -translate-y-1/2"
      style={{ left: 0, right: 0, background: "hsl(var(--border))" }}
    />
    <div
      className="absolute top-1/2 h-px -translate-y-1/2"
      style={{
        left: pct(0.1),
        width: pct(0.8),
        background: "hsl(var(--muted-foreground) / 0.45)",
      }}
    />
    <div
      className="absolute top-1/2 h-2 -translate-y-1/2 rounded"
      style={{
        left: pct(0.25),
        width: pct(0.5),
        background: "hsl(var(--primary) / 0.18)",
      }}
    />
    <div
      className="absolute top-1/2 h-3.5 w-px -translate-y-1/2"
      style={{ left: pct(0.5), background: "hsl(var(--muted-foreground))" }}
    />
    <div
      className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
      style={
        {
          left: pct(Math.max(0.02, Math.min(0.98, percentile))),
          background: risk ? "hsl(var(--destructive))" : "hsl(var(--primary))",
          // ring blends the dot into the card so it reads as a marker on the line
          "--tw-ring-color": "hsl(var(--card))",
        } as CSSProperties
      }
    />
  </div>
);

const LEVEL_LABEL: Record<
  NormalcyLevel,
  { bg: string; en: string; cls: string }
> = {
  typical: {
    bg: "Типично",
    en: "Typical",
    cls: "bg-muted text-muted-foreground",
  },
  notable: {
    bg: "Гранично",
    en: "Borderline",
    cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  },
  unusual: {
    bg: "Необичайно",
    en: "Unusual",
    cls: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  },
  insufficient: {
    bg: "Малка извадка",
    en: "Small sample",
    cls: "bg-muted text-muted-foreground/70",
  },
};

const Chip: FC<{ level: NormalcyLevel; neutral?: boolean }> = ({
  level,
  neutral,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const l = LEVEL_LABEL[level];
  const label =
    neutral && level === "typical"
      ? bg
        ? "В нормите"
        : "In range"
      : bg
        ? l.bg
        : l.en;
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${l.cls}`}
    >
      {label}
    </span>
  );
};

// One metric row: label + value/median on the left, the ruler in the middle,
// the verdict chip on the right. `pctTitle` surfaces the exact percentile on hover.
const MetricRow: FC<{
  icon: ReactNode;
  label: string;
  value: ReactNode;
  strip: ReactNode;
  chip: ReactNode;
  pctTitle?: string;
}> = ({ icon, label, value, strip, chip, pctTitle }) => (
  <div className="grid grid-cols-[9.5rem_1fr_auto] items-center gap-3 py-2.5">
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium tabular-nums">{value}</div>
    </div>
    <div title={pctTitle}>{strip}</div>
    <div className="justify-self-end">{chip}</div>
  </div>
);

export const ContractNormalcyPanel: FC<{ contractKey?: string }> = ({
  contractKey,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = useContractNormalcy(contractKey);
  if (!data || (!data.cohort && !data.concentration)) return null;

  const { deviations, evaluated } = normalcyDeviationSummary(data);
  const median = (v: number | null | undefined) =>
    v == null ? "—" : formatEurCompact(v, i18n.language);

  const bidsWord = (n: number) =>
    bg ? (n === 1 ? "оферта" : "оферти") : n === 1 ? "bid" : "bids";

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4 text-indigo-600" />
            {bg
              ? "Колко типична е тази поръчка?"
              : "How typical is this procurement?"}
          </h2>
          {data.cohort ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {bg ? "Сравнено с" : "Compared with"}{" "}
              {formatInt(data.cohort.n, i18n.language)}{" "}
              {bg ? "сходни" : "similar"} · CPV {data.cohort.cpvPrefix} ·{" "}
              {data.cohort.yearFrom}
              {data.cohort.yearTo !== data.cohort.yearFrom
                ? `–${data.cohort.yearTo}`
                : ""}
            </p>
          ) : null}
        </div>
        {evaluated > 0 ? (
          <span
            className={`inline-flex items-center rounded px-2.5 py-1 text-xs font-medium ${
              deviations > 0
                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
            }`}
          >
            {deviations > 0
              ? bg
                ? `${deviations} от ${evaluated} показателя се отклоняват`
                : `${deviations} of ${evaluated} indicators deviate`
              : bg
                ? "Без отклонения спрямо сходните"
                : "No deviations from similar"}
          </span>
        ) : null}
      </div>

      {data.cohort && !data.cohort.sufficient ? (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
          {bg
            ? "Малко сходни поръчки — сравнението е ориентировъчно."
            : "Few similar procurements — treat the comparison as indicative."}
        </p>
      ) : null}

      <div className="mt-2 divide-y">
        {data.value
          ? (() => {
              const v = normalcyVerdict(
                data.value.percentile,
                "neutral",
                data.value.n,
              );
              return (
                <MetricRow
                  icon={<Euro className="h-3.5 w-3.5" />}
                  label={bg ? "Стойност" : "Value"}
                  value={
                    <>
                      {formatEurCompact(data.value.value, i18n.language)}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        · {bg ? "медиана" : "median"}{" "}
                        {median(data.value.median)}
                      </span>
                    </>
                  }
                  strip={
                    <Strip
                      percentile={data.value.percentile}
                      dir="neutral"
                      risk={false}
                    />
                  }
                  chip={<Chip level={v.level} neutral />}
                  pctTitle={`${Math.round(data.value.percentile * 100)}${bg ? "-и персентил" : "th percentile"}`}
                />
              );
            })()
          : null}

        {data.bidders
          ? (() => {
              const v = normalcyVerdict(
                data.bidders.percentile,
                "low",
                data.bidders.n,
              );
              return (
                <MetricRow
                  icon={<Users className="h-3.5 w-3.5" />}
                  label={bg ? "Брой оферти" : "Bids"}
                  value={
                    <>
                      {formatInt(data.bidders.value, i18n.language)}{" "}
                      {bidsWord(data.bidders.value)}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        · {bg ? "медиана" : "median"}{" "}
                        {formatInt(
                          Math.round(data.bidders.median),
                          i18n.language,
                        )}
                      </span>
                    </>
                  }
                  strip={
                    <Strip
                      percentile={data.bidders.percentile}
                      dir="low"
                      risk={v.isRiskDeviation}
                    />
                  }
                  chip={<Chip level={v.level} />}
                  pctTitle={
                    bg
                      ? `Единствена оферта в ${formatPct(data.bidders.singleShare, i18n.language, 0)} от сходните`
                      : `Single-bidder in ${formatPct(data.bidders.singleShare, i18n.language, 0)} of similar`
                  }
                />
              );
            })()
          : null}

        {data.procedure && procedureEvaluable(data.procedure)
          ? (() => {
              const level: NormalcyLevel = procedureIsDeviation(data.procedure)
                ? "unusual"
                : "typical";
              return (
                <MetricRow
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label={bg ? "Вид процедура" : "Procedure"}
                  value={procedureLabel(
                    data.procedure.bucket as ProcedureBucket,
                    i18n.language,
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
                        {formatPct(data.procedure.openShare, i18n.language, 0)}{" "}
                        {bg ? "открити" : "open"}
                      </span>
                    </div>
                  }
                  chip={<Chip level={level} />}
                />
              );
            })()
          : null}

        {data.concentration
          ? (() => {
              const v = normalcyVerdict(
                data.concentration.percentile,
                "high",
                data.concentration.peerN,
              );
              return (
                <MetricRow
                  icon={<PieChart className="h-3.5 w-3.5" />}
                  label={bg ? "Дял при възложителя" : "Share of this buyer"}
                  value={
                    <>
                      {formatPct(data.concentration.value, i18n.language, 1)}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        · {bg ? "медиана" : "median"}{" "}
                        {formatPct(data.concentration.median, i18n.language, 1)}
                      </span>
                    </>
                  }
                  strip={
                    <Strip
                      percentile={data.concentration.percentile}
                      dir="high"
                      risk={v.isRiskDeviation}
                    />
                  }
                  chip={<Chip level={v.level} />}
                  pctTitle={
                    bg
                      ? `Спрямо ${formatInt(data.concentration.peerN, i18n.language)} изпълнителя на този възложител`
                      : `Among ${formatInt(data.concentration.peerN, i18n.language)} suppliers of this buyer`
                  }
                />
              );
            })()
          : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground/80">
        <span className="inline-flex items-center gap-1.5">
          <Info className="h-3 w-3" />
          {bg
            ? "Сравнение със сходни поръчки — контекст, не заключение за нарушение."
            : "A comparison with similar procurements — context, not a finding of wrongdoing."}
        </span>
        {data.cohort ? (
          <Link
            to={`/procurement/contracts?q=${encodeURIComponent(data.cohort.cpvPrefix)}`}
            className="text-primary hover:underline"
          >
            {bg ? "Виж сходни поръчки" : "Browse similar"}
          </Link>
        ) : null}
      </div>
    </section>
  );
};
