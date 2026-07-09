import { FC } from "react";
import { useTranslation } from "react-i18next";
import { LineChart, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { SOFIA_REGIONS } from "@/data/dataTypes";
import {
  useRegional,
  selectLatestForOblast,
  formatRegionalValue,
  type RegionalLatest,
} from "@/data/regional/useRegional";
import { StatCard } from "./StatCard";

type Props = {
  regionCode: string;
};

const DeltaBadge: FC<{
  delta: number | undefined;
  kind: "percent" | "absolute" | undefined;
  higherIsWorse?: boolean;
}> = ({ delta, kind, higherIsWorse }) => {
  if (delta === undefined || !Number.isFinite(delta))
    return <span className="text-muted-foreground">—</span>;
  const rounded = Math.round(delta * 10) / 10;
  const positive = rounded > 0;
  const neutral = rounded === 0;
  const Icon = neutral ? Minus : positive ? TrendingUp : TrendingDown;
  // Colour by whether the change is GOOD, not by its sign: for "higher is worse"
  // indicators (theft, unemployment, death rate) a rise is bad → red.
  const good = higherIsWorse ? !positive : positive;
  const cls = neutral
    ? "text-muted-foreground"
    : good
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-rose-600 dark:text-rose-400";
  const suffix = kind === "absolute" ? "" : "%";
  const display = `${positive ? "+" : ""}${rounded.toFixed(1)}${suffix}`;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${cls}`}>
      <Icon className="h-3 w-3" />
      {display}
    </span>
  );
};

const IndicatorRow: FC<{ item: RegionalLatest; lang: string }> = ({
  item,
  lang,
}) => {
  const title = lang === "bg" ? item.meta.titleBg : item.meta.titleEn;
  const unit = lang === "bg" ? item.meta.unitLabelBg : item.meta.unitLabelEn;
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-muted-foreground">{title}</div>
        <div className="text-[10px] text-muted-foreground/70">{unit}</div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm">
          {formatRegionalValue(item.key, item.latest.value, lang)}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {item.latest.year} ·{" "}
          <DeltaBadge
            delta={item.yoyDelta}
            kind={item.deltaKind}
            higherIsWorse={item.higherIsWorse}
          />
        </div>
      </div>
    </div>
  );
};

export const RegionalIndicatorsTile: FC<Props> = ({ regionCode }) => {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useRegional();

  if (isLoading) return null;
  const items = selectLatestForOblast(data, regionCode);
  if (items.length === 0) return null;

  // Sofia city МИР (S23/S24/S25) share the same indicator — values are
  // published for Sofia-stolitsa as one NUTS3 entity. Render the same
  // tile but add a footnote so users don't think we have МИР-level data.
  const isSofiaMir = SOFIA_REGIONS.includes(regionCode);

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <LineChart className="h-4 w-4" />
          <span>{t("regional_tile_heading")}</span>
        </div>
      }
      hint={t("regional_tile_hint")}
    >
      <div className="flex flex-col divide-y divide-border/60">
        {items.map((item) => (
          <IndicatorRow key={item.key} item={item} lang={i18n.language} />
        ))}
      </div>
      {isSofiaMir && (
        <p className="mt-2 text-[10px] italic text-muted-foreground">
          {t("regional_sofia_oblast_footnote")}
        </p>
      )}
      <p className="mt-1 text-[10px] text-muted-foreground/80">
        {t("regional_source_attribution")}
      </p>
    </StatCard>
  );
};
