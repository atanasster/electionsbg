// One KPI tile for the /indicators landing dashboard. Drops into a grid cell;
// renders the indicator's name, the latest value (formatted from the registry
// entry), an EU27 rank badge when available, a YoY arrow, a cabinet-shaded
// sparkline, and a source/period footer. The whole tile is a <Link> to the
// indicator's domain page.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGovernments } from "@/data/governments/useGovernments";
import { useMacro, type MacroIndicatorKey } from "@/data/macro/useMacro";
import { useMacroPeers } from "@/data/macro/useMacroPeers";
import {
  lastNYearsEnding,
  pickAtOrBefore,
  yoyChangeFor,
  type AsOf,
} from "@/data/macro/kpiSelectors";
import { useElectionAsOf } from "@/data/macro/useElectionAsOf";
import { useCabinetAnchor } from "@/data/macro/cabinetAnchorContext";
import {
  DOMAIN_PATHS,
  KPI_REGISTRY,
} from "@/screens/indicators/indicatorsRegistry";
import { KpiSparkline } from "./KpiSparkline";
import { RankBadge } from "./RankBadge";
import { YoyArrow } from "./YoyArrow";
import { VerdictChip, deriveVerdict } from "./VerdictChip";

const SPARKLINE_MIN_POINTS = 4;

const formatPeriod = (
  raw: string | undefined,
  year: number,
  quarter: 1 | 2 | 3 | 4 | undefined,
  lang: "bg" | "en",
): string => {
  if (raw) {
    const m = /^(\d{4})-Q([1-4])$/.exec(raw);
    if (m) {
      return lang === "bg" ? `${m[2]} тр. ${m[1]}` : `${m[1]} Q${m[2]}`;
    }
    return raw;
  }
  if (quarter)
    return lang === "bg" ? `${quarter} тр. ${year}` : `${year} Q${quarter}`;
  return `${year}`;
};

type Props = {
  indicatorKey: MacroIndicatorKey;
  className?: string;
};

export const KpiTile: FC<Props> = ({ indicatorKey, className }) => {
  const { i18n, t } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: macro } = useMacro();
  const { data: peers } = useMacroPeers();
  const { data: governments } = useGovernments();
  const asOf = useElectionAsOf();
  const anchor = useCabinetAnchor();
  const entry = KPI_REGISTRY[indicatorKey];

  const series = macro?.series[indicatorKey];
  const latest = useMemo(() => pickAtOrBefore(series, asOf), [series, asOf]);
  const sparklinePoints = useMemo(
    () => (entry ? lastNYearsEnding(series, entry.sparklineYears, latest) : []),
    [series, entry, latest],
  );
  const yoy = useMemo(() => yoyChangeFor(series, latest), [series, latest]);

  // Term-bounded snapshot. When a cabinet anchor is active, also compute
  // term-start vs term-end for the indicator so the footer can show "under
  // [Cabinet]: X → Y (delta)". Cabinet-end value mirrors what `latest` already
  // resolves to (asOf == anchor's tenure-end), so we only need term-start.
  const termSpan = useMemo(() => {
    if (!anchor || !series) return null;
    const g = anchor.cabinet;
    const start = new Date(g.startDate);
    const startAnchor: AsOf = {
      year: start.getUTCFullYear(),
      quarter: (Math.floor(start.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4,
    };
    const startPoint = pickAtOrBefore(series, startAnchor);
    if (!startPoint || !latest) return null;
    return { start: startPoint, end: latest };
  }, [anchor, series, latest]);

  if (!entry || !macro) {
    return (
      <div
        className={cn(
          "rounded-xl border bg-card p-4 shadow-sm h-[180px] animate-pulse",
          className,
        )}
      />
    );
  }
  const meta = macro.indicators[indicatorKey];
  if (!meta || !latest) {
    return null;
  }

  const title = lang === "bg" ? meta.titleBg : meta.titleEn;
  const periodLabel = formatPeriod(
    latest.period,
    latest.year,
    latest.quarter,
    lang,
  );

  const dist = entry.peerEligible
    ? peers?.indicators?.[indicatorKey]?.latestDistribution
    : null;
  // Only show the rank badge when the distribution period matches the headline
  // value period — mixing periods would mislead.
  const distAligned =
    dist != null &&
    ((latest.period && dist.period === latest.period) ||
      (dist.year === latest.year && dist.quarter === latest.quarter));

  const verdict = deriveVerdict({
    direction: entry.direction,
    rank: distAligned && dist ? { rank: dist.rank, total: dist.total } : null,
    yoyDelta: yoy?.delta ?? null,
  });

  const href = entry.anchor
    ? `${DOMAIN_PATHS[entry.domain]}#${entry.anchor}`
    : DOMAIN_PATHS[entry.domain];

  // Anchor-aware footer. When a cabinet is anchored AND we resolved both
  // term-start and term-end values, render an extra row linking to the
  // detail page with the indicator anchor pre-scrolled.
  const anchorFooter = (() => {
    if (!anchor || !termSpan) return null;
    const delta = termSpan.end.value - termSpan.start.value;
    const deltaText = entry.formatDelta
      ? `${delta >= 0 ? "+" : ""}${entry.formatDelta(delta)}`
      : entry.deltaSuffix === "pp"
        ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pp`
        : `${delta >= 0 ? "+" : ""}${delta.toFixed(
            entry.deltaDecimals ?? 1,
          )}${entry.deltaSuffix}`;
    const surname =
      (lang === "bg" ? anchor.cabinet.pmBg : anchor.cabinet.pmEn)
        .split(" ")
        .pop() ?? "";
    return (
      <Link
        to={`/governments/${encodeURIComponent(anchor.cabinet.id)}#kpi-${indicatorKey}`}
        onClick={(e) => e.stopPropagation()}
        className="block text-[10px] tabular-nums text-muted-foreground hover:text-foreground hover:underline"
      >
        {t("kpi_under_cabinet", {
          name: surname,
          start: entry.format(termSpan.start.value),
          end: entry.format(termSpan.end.value),
          delta: deltaText,
        })}
      </Link>
    );
  })();

  const showSparkline = sparklinePoints.length >= SPARKLINE_MIN_POINTS;

  // Series colour — keep neutral so the cabinet bands carry the political
  // colouring. A single deep slate works on both light and dark themes.
  const lineColor = "var(--foreground)";

  return (
    <Link
      to={href}
      aria-label={title}
      className={cn(
        "group relative flex h-full flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        <ArrowUpRight
          className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 group-hover:text-primary"
          aria-hidden
        />
      </div>

      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-2xl font-bold tabular-nums">
          {entry.format(latest.value)}
        </span>
        <YoyArrow
          delta={yoy?.delta ?? null}
          direction={entry.direction}
          suffix={entry.deltaSuffix}
          decimals={entry.deltaDecimals}
          formatMagnitude={entry.formatDelta}
          className="text-xs"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {distAligned && dist ? (
          <RankBadge
            rank={dist.rank}
            total={dist.total}
            direction={dist.direction}
          />
        ) : null}
        <VerdictChip verdict={verdict} />
      </div>

      {showSparkline ? (
        <div className="mt-auto pt-1" style={{ color: lineColor }}>
          <KpiSparkline
            points={sparklinePoints}
            governments={governments ?? []}
            ariaLabel={`${title} sparkline`}
          />
        </div>
      ) : (
        <div className="mt-auto h-7" />
      )}

      <div className="flex flex-col gap-0.5">
        {anchorFooter}
        <div className="text-[10px] text-muted-foreground tabular-nums">
          {periodLabel}
        </div>
      </div>
    </Link>
  );
};
