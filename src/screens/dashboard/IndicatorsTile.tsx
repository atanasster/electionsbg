import { FC } from "react";
import { useTranslation } from "react-i18next";
import { LineChart, Minus, TrendingDown, TrendingUp } from "lucide-react";
import {
  formatIndicatorValue,
  indicatorHigherIsBetter,
  selectIndicatorsFromSlice,
  useIndicatorSlice,
  type IndicatorDeltaKind,
  type IndicatorLatest,
} from "@/data/indicators/useIndicators";
import { StatCard } from "./StatCard";

type Props = {
  obshtinaCode: string;
};

const DeltaBadge: FC<{
  delta: number | undefined;
  kind: IndicatorDeltaKind;
  higherIsBetter: boolean;
}> = ({ delta, kind, higherIsBetter }) => {
  if (delta === undefined || !Number.isFinite(delta))
    return <span className="text-muted-foreground">—</span>;
  const rounded = Math.round(delta * 10) / 10;
  const positive = rounded > 0;
  const neutral = rounded === 0;
  const Icon = neutral ? Minus : positive ? TrendingUp : TrendingDown;
  // Green = movement in the "good" direction for this indicator.
  // Red = movement in the "bad" direction.
  const isGoodMove = neutral
    ? null
    : (positive && higherIsBetter) || (!positive && !higherIsBetter);
  const cls = neutral
    ? "text-muted-foreground"
    : isGoodMove
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-rose-600 dark:text-rose-400";
  const suffix = kind === "absolute" ? " pp" : "%";
  const display = `${positive ? "+" : ""}${rounded.toFixed(1)}${suffix}`;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${cls}`}>
      <Icon className="h-3 w-3" />
      {display}
    </span>
  );
};

const IndicatorRow: FC<{ item: IndicatorLatest; lang: string }> = ({
  item,
  lang,
}) => {
  const title = lang === "bg" ? item.meta.labelBg : item.meta.labelEn;
  const unit = lang === "bg" ? item.meta.unitBg : item.meta.unitEn;
  const higherIsBetter = indicatorHigherIsBetter(item.key);
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-muted-foreground">{title}</div>
        <div className="text-[10px] text-muted-foreground/70">{unit}</div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm">
          {formatIndicatorValue(item.latest.value)}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {item.latest.year} ·{" "}
          <DeltaBadge
            delta={item.yoyDelta}
            kind={item.deltaKind}
            higherIsBetter={higherIsBetter}
          />
        </div>
      </div>
    </div>
  );
};

export const IndicatorsTile: FC<Props> = ({ obshtinaCode }) => {
  const { t, i18n } = useTranslation();
  // Per-muni slice (~2 KB) instead of the 200+ KB bundle. The choropleth on
  // /demographics keeps using the bundle since it needs every muni at once.
  const { data: slice, isLoading } = useIndicatorSlice(obshtinaCode);

  if (isLoading) return null;
  const items = selectIndicatorsFromSlice(slice);
  if (items.length === 0) return null;

  const hasSofiaFallback = items.some((i) => i.fallback === "sofia-city");
  // Distinct sources across visible indicators — collapsed into one line so
  // multi-indicator tiles credit every upstream without bloat.
  const sources = Array.from(
    new Set(items.map((i) => i.meta.source.name)),
  ).join(" · ");
  const sourcePrefix = i18n.language === "bg" ? "Източник:" : "Source:";

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <LineChart className="h-4 w-4" />
          <span>{t("indicators_tile_heading")}</span>
        </div>
      }
      hint={t("indicators_tile_hint")}
    >
      <div className="flex flex-col divide-y divide-border/60">
        {items.map((item) => (
          <IndicatorRow key={item.key} item={item} lang={i18n.language} />
        ))}
      </div>
      {hasSofiaFallback && (
        <p className="mt-2 text-[10px] italic text-muted-foreground">
          {t("indicators_sofia_city_footnote")}
        </p>
      )}
      <p className="mt-1 text-[10px] text-muted-foreground/80">
        {sourcePrefix} {sources}.
      </p>
    </StatCard>
  );
};
