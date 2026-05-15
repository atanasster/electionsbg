// Per-MP scorecard. Packages four already-computed signals (party loyalty,
// attendance, declared net worth, procurement to connected firms) onto one
// tile so the MP profile opens with a one-glance summary before the deeper
// sections below. Each metric carries a rank within the same parliament so
// the reader can judge "is this MP unusual or typical?" at a glance.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  Wallet,
  Vote,
  Landmark,
  CalendarCheck,
  LucideIcon,
} from "lucide-react";
import { useMpScorecard } from "@/data/parliament/useMpScorecard";

type Props = { name: string };

const numberFmt = (locale: string) =>
  new Intl.NumberFormat(locale === "bg" ? "bg-BG" : "en-GB");

const formatPct = (frac: number | null, locale: string): string => {
  if (frac == null || !Number.isFinite(frac)) return "—";
  return new Intl.NumberFormat(locale === "bg" ? "bg-BG" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(frac);
};

const formatCompactEur = (value: number | null, locale: string): string => {
  if (value == null || !Number.isFinite(value)) return "—";
  const out = new Intl.NumberFormat(locale === "bg" ? "bg-BG" : "en-GB", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
  return `€${out}`;
};

type MetricProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  context?: string | null;
  /** Tint the value text amber when this metric reads as a concern.
   *  e.g. high contracts-to-connected-firms or unusually low attendance. */
  warn?: boolean;
};

const Metric: FC<MetricProps> = ({
  icon: Icon,
  label,
  value,
  context,
  warn,
}) => (
  <div className="flex h-full flex-col gap-1 rounded-xl border bg-card p-3 shadow-sm">
    <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="line-clamp-2 break-words leading-tight">{label}</span>
    </div>
    <div
      className={`text-2xl font-bold tabular-nums leading-tight ${
        warn ? "text-amber-600" : ""
      }`}
    >
      {value}
    </div>
    {context ? (
      <div className="mt-auto pt-0.5 text-[10px] text-muted-foreground tabular-nums">
        {context}
      </div>
    ) : null}
  </div>
);

export const MpScorecardTile: FC<Props> = ({ name }) => {
  const { t, i18n } = useTranslation();
  const { scorecard, isLoading } = useMpScorecard(name);
  const lang = i18n.language;

  if (isLoading) {
    return (
      <div className="my-4" aria-hidden>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[110px] animate-pulse rounded-xl border bg-muted/40"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!scorecard.hasAny) return null;

  const fmt = numberFmt(lang);
  const rankLabel = t("mp_scorecard_rank_of") || "rank";
  const medianLabel = t("mp_scorecard_median") || "median";

  const rankContext = (m: {
    rank: number | null;
    cohortSize: number;
  }): string | null => {
    if (m.rank == null || m.cohortSize === 0) return null;
    // "#3 от 240" / "#3 of 240"
    const sep = lang === "bg" ? "от" : "of";
    return `#${m.rank} ${sep} ${fmt.format(m.cohortSize)} · ${rankLabel}`;
  };

  const loyaltyContext =
    scorecard.loyalty.median != null
      ? `${medianLabel} ${formatPct(scorecard.loyalty.median, lang)}`
      : rankContext(scorecard.loyalty);

  const attendanceContext =
    scorecard.attendance.median != null
      ? `${medianLabel} ${formatPct(scorecard.attendance.median, lang)}`
      : rankContext(scorecard.attendance);

  const netWorthContext = rankContext(scorecard.netWorth);

  const contractsContext = rankContext(scorecard.connectedContracts);

  // The "low attendance" warn threshold matches the cohesion screen's
  // intuition: below the median, the MP shows up less than half their peers.
  const attendanceWarn =
    scorecard.attendance.value != null &&
    scorecard.attendance.median != null &&
    scorecard.attendance.value < scorecard.attendance.median * 0.7;

  // Highlight contracts-to-connected-firms only when this MP is in the top
  // decile of the (already self-selected) "MPs whose firms won contracts"
  // cohort. Below that bar it's not noteworthy.
  const contractsWarn =
    scorecard.connectedContracts.rank != null &&
    scorecard.connectedContracts.cohortSize > 0 &&
    scorecard.connectedContracts.rank <=
      Math.max(1, Math.ceil(scorecard.connectedContracts.cohortSize / 10));

  return (
    <section
      aria-label={t("mp_scorecard_label") || "MP scorecard"}
      className="my-4"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          icon={Vote}
          label={t("mp_scorecard_loyalty") || "Party loyalty"}
          value={formatPct(scorecard.loyalty.value, lang)}
          context={loyaltyContext}
        />
        <Metric
          icon={CalendarCheck}
          label={t("mp_scorecard_attendance") || "Attendance"}
          value={formatPct(scorecard.attendance.value, lang)}
          context={attendanceContext}
          warn={attendanceWarn}
        />
        <Metric
          icon={Wallet}
          label={t("mp_scorecard_net_worth") || "Declared net worth"}
          value={formatCompactEur(scorecard.netWorth.value, lang)}
          context={netWorthContext}
        />
        <Metric
          icon={Landmark}
          label={
            t("mp_scorecard_connected_contracts") ||
            "Contracts to connected firms"
          }
          value={
            scorecard.connectedContracts.value == null
              ? "—"
              : formatCompactEur(scorecard.connectedContracts.value, lang)
          }
          context={contractsContext}
          warn={contractsWarn}
        />
      </div>
    </section>
  );
};
