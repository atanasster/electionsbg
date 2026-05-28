// Collapsed-by-default footer card that holds the "deep history" of a
// place — voter turnout sparkline over recent cycles plus the
// drill-down link to the full canonical dashboard.
//
// Settlement view uses useSettlementStats (one fetch, all cycles for that
// settlement). Município view falls back to a link-only card since
// useMunicipalityStats keys by oblast and would mix cycles across multiple
// settlements; that case can grow into its own variant later.
//
// Implemented as a native <details> element so collapsed state is free
// (no React state, no JS to track open/close, keyboard-accessible by
// default).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, BarChart3, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Link } from "@/ux/Link";
import type { ResolvedArea } from "@/data/area/useAreaResolver";
import { useSettlementStats } from "@/data/settlements/useSettlementStats";

type Props = {
  area: Extract<
    ResolvedArea,
    { kind: "settlement" } | { kind: "municipality" }
  >;
};

type TurnoutPoint = {
  cycle: string; // election name (folder slug)
  turnout: number; // 0..1
};

const formatPct = (n: number, lang: "bg" | "en"): string =>
  (n * 100).toLocaleString(lang === "bg" ? "bg-BG" : "en-GB", {
    maximumFractionDigits: 1,
  }) + "%";

const formatCycleShort = (cycle: string): string => {
  // "2026_04_19" → "04.26", "2024_06_09" → "06.24"
  const m = cycle.match(/^(\d{4})_(\d{2})_/);
  if (!m) return cycle;
  return `${m[2]}.${m[1].slice(2)}`;
};

const SettlementHistoryBody: FC<{ ekatte: string; lang: "bg" | "en" }> = ({
  ekatte,
  lang,
}) => {
  const { stats } = useSettlementStats(ekatte);
  const points = useMemo<TurnoutPoint[]>(() => {
    if (!stats || stats.length === 0) return [];
    const out: TurnoutPoint[] = [];
    for (const e of stats) {
      const p = e.results?.protocol;
      const reg = p?.numRegisteredVoters ?? 0;
      const voters = p?.totalActualVoters ?? 0;
      if (reg > 0 && voters > 0) {
        out.push({ cycle: e.name, turnout: voters / reg });
      }
    }
    // Sort ascending by cycle name (date-shaped folder slugs sort
    // naturally). Cap at the last 8 cycles — beyond that the sparkline
    // gets too noisy at this small size.
    out.sort((a, b) => a.cycle.localeCompare(b.cycle));
    return out.slice(-8);
  }, [stats]);

  if (points.length < 2) {
    return (
      <p className="text-xs text-muted-foreground">
        {lang === "bg"
          ? "Не достатъчно данни за тренд."
          : "Not enough data for a trend."}
      </p>
    );
  }

  const turnoutVals = points.map((p) => p.turnout);
  const minT = Math.min(...turnoutVals);
  const maxT = Math.max(...turnoutVals);
  const spread = maxT - minT || 0.001;
  const W = 240;
  const H = 48;
  const padY = 6;
  const pathD = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * W;
      const y = H - padY - ((p.turnout - minT) / spread) * (H - padY * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const last = points[points.length - 1];
  const first = points[0];
  const delta = last.turnout - first.turnout;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-4">
        <div className="flex flex-col">
          <span className="text-2xl font-bold tabular-nums leading-tight">
            {formatPct(last.turnout, lang)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {lang === "bg" ? "избирателна активност" : "voter turnout"} ·{" "}
            {formatCycleShort(last.cycle)}
          </span>
        </div>
        <div className="flex flex-col">
          <svg width={W} height={H} aria-hidden className="text-primary">
            <path
              d={pathD}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="flex justify-between text-[9px] text-muted-foreground tabular-nums">
            <span>{formatCycleShort(first.cycle)}</span>
            <span>{formatCycleShort(last.cycle)}</span>
          </div>
        </div>
        <div
          className={`text-xs tabular-nums ${
            delta >= 0 ? "text-emerald-600" : "text-rose-600"
          }`}
        >
          {delta >= 0 ? "+" : ""}
          {(delta * 100).toFixed(1)}
          {lang === "bg" ? " пр.пр." : " pp"}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {lang === "bg"
          ? `Базирано на протоколите от ${points.length} цикъла. Само за това населено място.`
          : `Based on protocols from ${points.length} cycles. This settlement only.`}
      </p>
    </div>
  );
};

export const MyAreaHistoryStrip: FC<Props> = ({ area }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const fullHref =
    area.kind === "settlement"
      ? `/settlement/${area.ekatte}`
      : `/municipality/${area.oblast}`;
  const fullLabel =
    area.kind === "settlement"
      ? lang === "bg"
        ? "Виж пълно табло на населеното място"
        : "View full settlement dashboard"
      : lang === "bg"
        ? "Виж пълно табло на общината"
        : "View full municipality dashboard";

  return (
    <Card className="p-0 mt-2 overflow-hidden">
      <details className="group">
        <summary className="cursor-pointer list-none flex items-center gap-2 p-3 hover:bg-accent/30 transition-colors">
          <BarChart3 className="size-4 text-primary shrink-0" />
          <span className="text-sm font-medium flex-1">
            {lang === "bg" ? "История на района" : "Area history"}
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-4 pb-4 pt-2 border-t flex flex-col gap-3">
          {area.kind === "settlement" ? (
            <SettlementHistoryBody ekatte={area.ekatte} lang={lang} />
          ) : (
            <p className="text-xs text-muted-foreground">
              {lang === "bg"
                ? "Изборната история на общинско ниво е достъпна на пълното табло."
                : "Cycle-by-cycle municipality history is available on the full dashboard."}
            </p>
          )}
          <Link
            to={fullHref}
            underline={false}
            className="flex items-center justify-between gap-2 text-sm rounded-md border p-2 hover:bg-accent/40 transition-colors group/full"
            aria-label={fullLabel}
          >
            <span className="font-medium">{fullLabel}</span>
            <ArrowRight className="size-4 text-muted-foreground group-hover/full:text-primary transition-colors" />
          </Link>
          {/* Reference `t` so future translatable copy lands here without
              re-adding the import — same pattern as elsewhere. */}
          <span hidden aria-hidden>
            {t("my_area_dashboard")}
          </span>
        </div>
      </details>
    </Card>
  );
};
