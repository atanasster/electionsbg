// Four-number summary of Bulgarian cabinet stability since 2005, designed
// to sit above the GovernmentsTile timeline on /governance. The numbers
// answer "how often does a cabinet finish its term" without making the
// reader parse the colour bands. All four derive from the same governments
// list the timeline already loads — no extra fetch.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CalendarCheck2,
  CalendarClock,
  Users,
} from "lucide-react";
import {
  useGovernments,
  type Government,
} from "@/data/governments/useGovernments";

// Cabinets whose endReason is in this set ended before a scheduled term-end.
const EARLY_END_REASONS = new Set<Government["endReason"]>([
  "snap_election",
  "no_confidence",
  "resignation",
  "rotation_failed",
]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const daysBetween = (start: string, end: string | null): number => {
  const s = new Date(start).getTime();
  const e = (end ? new Date(end) : new Date()).getTime();
  return Math.max(0, Math.round((e - s) / MS_PER_DAY));
};

interface Stats {
  total: number;
  regular: number;
  caretaker: number;
  earlyEnds: number;
  avgRegularDurationDays: number | null;
}

const computeStats = (governments: Government[]): Stats => {
  const total = governments.length;
  const regular = governments.filter((g) => g.type === "regular");
  const caretaker = governments.filter((g) => g.type === "caretaker");
  const earlyEnds = governments.filter((g) =>
    EARLY_END_REASONS.has(g.endReason),
  ).length;

  // Exclude the current open-ended cabinet from the average so a fresh
  // installation doesn't drag the mean down.
  const completedRegular = regular.filter(
    (g) => g.endDate != null && g.endReason !== "incumbent",
  );
  const avgDays =
    completedRegular.length > 0
      ? completedRegular.reduce(
          (acc, g) => acc + daysBetween(g.startDate, g.endDate),
          0,
        ) / completedRegular.length
      : null;

  return {
    total,
    regular: regular.length,
    caretaker: caretaker.length,
    earlyEnds,
    avgRegularDurationDays: avgDays != null ? Math.round(avgDays) : null,
  };
};

const formatMonths = (days: number): string => {
  const months = days / 30;
  if (months >= 12) {
    const years = months / 12;
    return years.toFixed(1);
  }
  return months.toFixed(1);
};

interface StatProps {
  icon: typeof Users;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}

const Stat: FC<StatProps> = ({ icon: Icon, label, value, sub, tone }) => (
  <div className="flex flex-col gap-1 rounded-lg border bg-card/50 px-3 py-2.5">
    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
      <Icon className={`h-3.5 w-3.5 ${tone ?? ""}`} />
      <span className="truncate">{label}</span>
    </div>
    <div
      className={`text-lg font-bold tabular-nums leading-tight ${tone ?? ""}`}
    >
      {value}
    </div>
    {sub ? (
      <div className="text-[11px] text-muted-foreground tabular-nums">
        {sub}
      </div>
    ) : null}
  </div>
);

export const GovernmentStabilityTile: FC = () => {
  const { t } = useTranslation();
  const { data: governments } = useGovernments();

  const stats = useMemo<Stats | null>(
    () => (governments?.length ? computeStats(governments) : null),
    [governments],
  );
  if (!stats) return null;

  const avgLabel =
    stats.avgRegularDurationDays != null
      ? stats.avgRegularDurationDays / 30 >= 12
        ? `${formatMonths(stats.avgRegularDurationDays)} ${t("stability_unit_years") || "years"}`
        : `${formatMonths(stats.avgRegularDurationDays)} ${t("stability_unit_months") || "months"}`
      : "—";

  return (
    <div
      className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3"
      aria-label={t("stability_aria_label") || "Cabinet stability since 2005"}
    >
      <Stat
        icon={Users}
        label={t("stability_total_label") || "Cabinets since 2005"}
        value={String(stats.total)}
        sub={`${stats.regular} ${t("stability_regular") || "regular"} · ${stats.caretaker} ${t("stability_caretaker") || "caretaker"}`}
      />
      <Stat
        icon={CalendarCheck2}
        label={t("stability_avg_label") || "Average regular cabinet"}
        value={avgLabel}
        sub={t("stability_avg_sub") || "completed regular cabinets only"}
      />
      <Stat
        icon={AlertTriangle}
        label={t("stability_early_label") || "Ended early"}
        value={String(stats.earlyEnds)}
        sub={
          t("stability_early_sub") ||
          "snap election, no-confidence, resignation, failed rotation"
        }
        tone="text-amber-700 dark:text-amber-400"
      />
      <Stat
        icon={CalendarClock}
        label={t("stability_caretaker_label") || "Caretaker cabinets"}
        value={String(stats.caretaker)}
        sub={
          t("stability_caretaker_sub") ||
          "appointed by the President between elections"
        }
      />
    </div>
  );
};
