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
  ChevronRight,
  LucideIcon,
} from "lucide-react";
import { useMpScorecard } from "@/data/parliament/useMpScorecard";
import { ATTENDANCE_MIN_ITEMS } from "@/data/parliament/votes/useAttendance";
import { gridCols } from "./scorecardGrid";

// Anchors on the person/candidate dashboard each scorecard metric drills into
// (the fuller breakdown lives further down the same page). Passed in by the
// host so the tile stays decoupled from the page layout; omit to keep a metric
// static (e.g. the standalone /candidate view has no such sections).
export type ScorecardLinks = {
  loyalty?: string;
  attendance?: string;
  netWorth?: string;
  connectedContracts?: string;
};

type Props = { name: string; links?: ScorecardLinks };

const numberFmt = (locale: string) =>
  new Intl.NumberFormat(locale === "bg" ? "bg-BG" : "en-GB");

const formatPct = (frac: number | null, locale: string): string => {
  if (frac == null || !Number.isFinite(frac)) return "—";
  return new Intl.NumberFormat(locale === "bg" ? "bg-BG" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(frac);
};

/** Does this metric have a value worth rendering? ONE predicate, shared with the formatters
 *  below, because they disagreed: the tile admitted a metric on `!= null` while the
 *  formatters dashed on `!Number.isFinite`, so a NaN or an Infinity would have slipped
 *  through the filter and rendered the exact dash-under-a-confident-label this tile exists
 *  to remove. No input reaches that state today (both SQL functions emit through
 *  `jsonb_build_object(…, round(…))`, so the client gets JSON numbers), which is why it is
 *  worth closing now rather than after a future route returns a numeric string. */
const has = (v: number | null): v is number => v != null && Number.isFinite(v);

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
  /** In-page anchor (e.g. "#parliament") the metric drills into. When set the
   *  whole tile becomes an anchor link with a hover affordance + corner chevron. */
  to?: string;
};

const Metric: FC<MetricProps> = ({
  icon: Icon,
  label,
  value,
  context,
  warn,
  to,
}) => {
  const body = (
    <>
      {to ? (
        <ChevronRight
          className="absolute right-2.5 top-3 h-3.5 w-3.5 text-muted-foreground opacity-50"
          aria-hidden
        />
      ) : null}
      {/* pr-4 when `to`: the chevron above is absolutely positioned (out of flow), so a
          two-word Cyrillic label runs under it at phone width. */}
      <div
        className={`flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground ${
          to ? "pr-4" : ""
        }`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="line-clamp-2 break-words leading-tight">{label}</span>
      </div>
      {/* text-xl below sm: these tiles sit two-per-row on a phone (~135px of content box),
          and a compact euro figure carries a non-breaking space ("€194,6 хил.") so it cannot
          wrap — at text-2xl it simply escapes the card. */}
      <div
        className={`text-xl sm:text-2xl font-bold tabular-nums leading-tight ${
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
    </>
  );
  const shell =
    "flex h-full flex-col gap-1 rounded-xl border bg-card p-3 shadow-sm";
  if (to) {
    return (
      <a
        href={to}
        className={`${shell} relative transition-colors hover:bg-accent/40 hover:border-primary/40`}
      >
        {body}
      </a>
    );
  }
  return <div className={`${shell} relative`}>{body}</div>;
};

export const MpScorecardTile: FC<Props> = ({ name, links }) => {
  const { t, i18n } = useTranslation();
  const { scorecard, isLoading, maxMetrics } = useMpScorecard(name);
  const lang = i18n.language;

  if (isLoading) {
    // Sized to the CEILING the hook can name without fetching, not to a fixed four. Before
    // the metric list became variable, four was exactly right — skeleton and settled layout
    // were identical by construction. Now, for the majority of MPs (no roll-call coverage),
    // four boxes reserve two phone rows for a block that settles to one.
    return (
      <div className="my-4" aria-hidden>
        <div className={`grid gap-3 ${gridCols(maxMetrics)}`}>
          {Array.from({ length: maxMetrics }, (_, i) => (
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
  //
  // Gated on the size of the seated window, because the rate is now measured over that
  // window rather than over the chamber's. A replacement MP sworn in for the term's last
  // sitting day appears in a single item; miss it and they read 0%, which is true and
  // means nothing — an amber tint on it is an accusation the number cannot support. The
  // 52nd holds 15 such seats at ≤9 items. Same floor the attendance table ranks on.
  const attendanceWarn =
    scorecard.attendance.value != null &&
    scorecard.attendance.median != null &&
    (scorecard.attendanceItems ?? 0) >= ATTENDANCE_MIN_ITEMS &&
    scorecard.attendance.value < scorecard.attendance.median * 0.7;

  // Highlight contracts-to-connected-firms only when this MP is in the top
  // decile of the (already self-selected) "MPs whose firms won contracts"
  // cohort. Below that bar it's not noteworthy.
  const contractsWarn =
    scorecard.connectedContracts.rank != null &&
    scorecard.connectedContracts.cohortSize > 0 &&
    scorecard.connectedContracts.rank <=
      Math.max(1, Math.ceil(scorecard.connectedContracts.cohortSize / 10));

  // Only metrics that HAVE a value are rendered. A dash is not a measurement — it is the
  // absence of one, and the four tiles gave no way to tell "this MP votes with their group
  // 62% of the time" from "we hold no roll-call for the parliaments this MP sat in".
  //
  // That second case is the majority, not an edge: the roll-call corpus starts 2020-10-28
  // (NS 44, itself only partial), so of 2,122 MPs on file 1,556 can never have a loyalty or
  // attendance figure. Every one of them used to render two dashes under confident labels.
  //
  // `hasAny` above is the same predicate applied to all four at once, so this list cannot be
  // empty here today. The guard below it is kept anyway: it is the only thing standing
  // between a future widening of `hasAny` (e.g. "has a rank") and a `GRID_COLS[0]`.
  // The grid then sizes itself to what survived rather than reserving four columns and
  // filling the gaps with nothing.
  const metrics = [
    has(scorecard.loyalty.value) && {
      key: "loyalty",
      icon: Vote,
      label: t("mp_scorecard_loyalty") || "Party loyalty",
      value: formatPct(scorecard.loyalty.value, lang),
      context: loyaltyContext,
      to: links?.loyalty,
    },
    has(scorecard.attendance.value) && {
      key: "attendance",
      icon: CalendarCheck,
      label: t("mp_scorecard_attendance") || "Attendance",
      value: formatPct(scorecard.attendance.value, lang),
      context: attendanceContext,
      warn: attendanceWarn,
      to: links?.attendance,
    },
    has(scorecard.netWorth.value) && {
      key: "netWorth",
      icon: Wallet,
      label: t("mp_scorecard_net_worth") || "Declared net worth",
      value: formatCompactEur(scorecard.netWorth.value, lang),
      context: netWorthContext,
      to: links?.netWorth,
    },
    has(scorecard.connectedContracts.value) && {
      key: "connectedContracts",
      icon: Landmark,
      label:
        t("mp_scorecard_connected_contracts") || "Contracts to connected firms",
      value: formatCompactEur(scorecard.connectedContracts.value, lang),
      context: contractsContext,
      warn: contractsWarn,
      to: links?.connectedContracts,
    },
  ].filter((m): m is Exclude<typeof m, false> => m !== false);

  if (metrics.length === 0) return null;

  return (
    <section
      aria-label={t("mp_scorecard_label") || "MP scorecard"}
      className="my-4"
    >
      <div className={`grid gap-3 ${gridCols(metrics.length)}`}>
        {metrics.map(({ key, ...m }) => (
          <Metric key={key} {...m} />
        ))}
      </div>
    </section>
  );
};
