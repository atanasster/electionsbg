// "Колко типична е тази поръчка?" — the cohort-distribution panel on the
// contract detail page. For each metric it positions this contract on a
// percentile ruler against a cohort of similar procurements (same CPV prefix),
// with a neutral positional verdict. DESCRIPTIVE, not a verdict of wrongdoing —
// the companion to the per-contract CRI badges. See migrations 063 + 064.

import { FC, ReactNode, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BarChart3, Users, Euro, FileText, PieChart } from "lucide-react";
import {
  useContractNormalcy,
  type NormalcyDir,
} from "@/data/procurement/useContractNormalcy";
import {
  normalcyVerdict,
  normalcyDeviationSummary,
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

// A flag colour shared by the deviation chips + summary badge — amber, not red:
// this is a signal to look, not a finding of wrongdoing.
const FLAG_CLS =
  "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300";
const AMBER_ZONE = "rgba(245, 158, 11, 0.16)";
const AMBER_DOT = "#d97706";

// Percentile ruler: the cohort's middle 50% is the grey band, the median a tick,
// the risk tail (weaker-competition side) an amber wash, and this contract a dot
// at its true cohort percentile. A ruler, not a value axis — so a heavy-tailed
// distribution never squishes the band; the value + median are shown in text.
// CSS-positioned (not SVG) so the marker stays a true circle at any width.
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
          background: AMBER_ZONE,
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
          background: risk ? AMBER_DOT : "hsl(var(--primary))",
          // ring blends the dot into the card so it reads as a marker on the line
          "--tw-ring-color": "hsl(var(--card))",
        } as CSSProperties
      }
    />
  </div>
);

const Chip: FC<{ label: string; flag?: boolean }> = ({ label, flag }) => (
  <span
    className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${
      flag ? FLAG_CLS : "bg-muted text-muted-foreground"
    }`}
  >
    {label}
  </span>
);

// One metric row: label + value + a muted median sub-line on the left (own line,
// never mid-wrap), the ruler in the middle, the verdict chip on the right.
const MetricRow: FC<{
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  strip: ReactNode;
  chip: ReactNode;
  pctTitle?: string;
}> = ({ icon, label, value, sub, strip, chip, pctTitle }) => (
  <div className="grid grid-cols-[10.5rem_1fr_auto] items-center gap-3 py-2.5">
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium leading-tight tabular-nums">
        {value}
      </div>
      {sub ? (
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {sub}
        </div>
      ) : null}
    </div>
    <div title={pctTitle}>{strip}</div>
    <div className="justify-self-end">{chip}</div>
  </div>
);

export const ContractNormalcyPanel: FC<{ contractKey?: string }> = ({
  contractKey,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useContractNormalcy(contractKey);
  if (!data || (!data.cohort && !data.concentration)) return null;

  const { deviations, evaluated } = normalcyDeviationSummary(data);

  // A neutral metric (value) is never a "deviation" — it's positioned, not
  // judged. Five tiers so a strong outlier (a value many times the median, which
  // the percentile ruler alone can't convey) reads as "много по-висока".
  const neutralLabel = (p: number, n: number): string => {
    if (n < NORMALCY_MIN_N) return bg ? "малка извадка" : "small sample";
    if (p >= 0.9) return bg ? "много по-висока" : "much higher";
    if (p > 0.75) return bg ? "по-висока" : "higher";
    if (p <= 0.1) return bg ? "много по-ниска" : "much lower";
    if (p < 0.25) return bg ? "по-ниска" : "lower";
    return bg ? "в нормите" : "in range";
  };

  // Shares are often well under 1% (a big buyer has many suppliers), so a flat
  // 1-dp "0%" reads as broken — widen the precision for small shares.
  const sharePct = (v: number): string => {
    if (v <= 0) return formatPct(0, lang, 0);
    if (v < 0.0001) return bg ? "<0,01%" : "<0.01%";
    return formatPct(v, lang, v < 0.01 ? 2 : 1);
  };

  const median = (label: ReactNode) => (
    <>
      {bg ? "медиана" : "median"} {label}
    </>
  );
  const bidsWord = (n: number) =>
    bg ? (n === 1 ? "оферта" : "оферти") : n === 1 ? "bid" : "bids";

  const cohort = data.cohort;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4 text-indigo-600" />
            {bg
              ? "Колко типична е тази поръчка?"
              : "How typical is this procurement?"}
          </h2>
          {cohort ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {bg ? "Сравнено с" : "Compared with"} {formatInt(cohort.n, lang)}{" "}
              {bg ? "сходни" : "similar"} ·{" "}
              {cpvDivisionName(cohort.cpvPrefix, lang)} (CPV {cohort.cpvPrefix})
              · {cohort.yearFrom}
              {cohort.yearTo !== cohort.yearFrom ? `–${cohort.yearTo}` : ""}
            </p>
          ) : null}
        </div>
        {evaluated > 0 ? (
          <span
            className={`inline-flex items-center rounded px-2.5 py-1 text-xs font-medium ${
              deviations > 0
                ? FLAG_CLS
                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
            }`}
          >
            {deviations > 0
              ? bg
                ? `${deviations} от ${evaluated} показателя за конкуренция се отклоняват`
                : `${deviations} of ${evaluated} competition indicators deviate`
              : bg
                ? "Без сигнали за по-слаба конкуренция"
                : "No weaker-competition signals"}
          </span>
        ) : null}
      </div>

      {cohort && !cohort.sufficient ? (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
          {bg
            ? "Малко сходни поръчки — сравнението е ориентировъчно."
            : "Few similar procurements — treat the comparison as indicative."}
        </p>
      ) : null}

      <div className="mt-2 divide-y">
        {data.value
          ? (() => {
              const p = data.value.percentile;
              return (
                <MetricRow
                  icon={<Euro className="h-3.5 w-3.5" />}
                  label={bg ? "Стойност" : "Value"}
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

        {data.bidders
          ? (() => {
              const v = normalcyVerdict(
                data.bidders.percentile,
                "low",
                data.bidders.n,
              );
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
                  icon={<Users className="h-3.5 w-3.5" />}
                  label={bg ? "Брой оферти" : "Bids"}
                  value={`${formatInt(data.bidders.value, lang)} ${bidsWord(data.bidders.value)}`}
                  sub={median(formatInt(Math.round(data.bidders.median), lang))}
                  strip={
                    <Strip
                      percentile={data.bidders.percentile}
                      dir="low"
                      risk={v.isRiskDeviation}
                    />
                  }
                  chip={<Chip label={label} flag={v.isRiskDeviation} />}
                  pctTitle={
                    bg
                      ? `Единствена оферта в ${formatPct(data.bidders.singleShare, lang, 0)} от сходните`
                      : `Single-bidder in ${formatPct(data.bidders.singleShare, lang, 0)} of similar`
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

        {data.concentration
          ? (() => {
              const v = normalcyVerdict(
                data.concentration.percentile,
                "high",
                data.concentration.peerN,
              );
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
                  icon={<PieChart className="h-3.5 w-3.5" />}
                  label={bg ? "Дял при възложителя" : "Share of this buyer"}
                  value={sharePct(data.concentration.value)}
                  sub={median(sharePct(data.concentration.median))}
                  strip={
                    <Strip
                      percentile={data.concentration.percentile}
                      dir="high"
                      risk={v.isRiskDeviation}
                    />
                  }
                  chip={<Chip label={label} flag={v.isRiskDeviation} />}
                  pctTitle={
                    bg
                      ? `Спрямо ${formatInt(data.concentration.peerN, lang)} изпълнителя на този възложител`
                      : `Among ${formatInt(data.concentration.peerN, lang)} suppliers of this buyer`
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
            {bg ? "по-слаба конкуренция" : "weaker competition"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: "hsl(var(--primary))" }}
            />
            {bg ? "тази поръчка" : "this contract"}
          </span>
        </div>
        {cohort ? (
          // Deep-link the CPV-PREFIX filter (cpv LIKE '<prefix>%') + full corpus
          // — ?q= is free-text (won't match a CPV code), and ?pscope only takes
          // year/all/parliament, so "all years" is the closest to the era cohort.
          <Link
            to={`/procurement/contracts?cpv=${encodeURIComponent(cohort.cpvPrefix)}&pscope=all`}
            className="text-primary hover:underline"
          >
            {bg ? "Виж сходни поръчки" : "Browse similar"}
          </Link>
        ) : null}
      </div>
    </section>
  );
};
