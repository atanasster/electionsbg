import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown } from "lucide-react";
import { PartyDashboardSummary } from "@/data/dashboard/partyDashboardTypes";
import { useRegions } from "@/data/regions/useRegions";
import { formatPct } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

const TOP_N = 5;

type Row = {
  key: string;
  name: string;
  currentPct: number;
  priorPct?: number;
  deltaPctPoints: number;
  color: string;
};

type Props = { data: PartyDashboardSummary };

export const PartyRegionSwingsTile: FC<Props> = ({ data }) => {
  const { t, i18n } = useTranslation();
  const { findRegion } = useRegions();

  const { gainers, losers } = useMemo(() => {
    const color = data.color ?? "#888";
    const enriched: Row[] = data.swings
      .filter((s) => s.deltaPctPoints !== undefined)
      .map((s) => {
        const info = findRegion(s.oblast);
        const name =
          (i18n.language === "bg"
            ? info?.long_name || info?.name
            : info?.long_name_en || info?.name_en) ||
          s.oblast ||
          s.key;
        return {
          key: s.key,
          name,
          currentPct: s.currentPct,
          priorPct: s.priorPct,
          deltaPctPoints: s.deltaPctPoints!,
          color,
        };
      });
    const sorted = [...enriched].sort(
      (a, b) => b.deltaPctPoints - a.deltaPctPoints,
    );
    return {
      gainers: sorted.slice(0, TOP_N),
      losers: sorted.slice(-TOP_N).reverse(),
    };
  }, [data, findRegion, i18n.language]);

  if (gainers.length === 0 && losers.length === 0) return null;

  const renderColumn = (rows: Row[], title: string, positive: boolean) => (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-1.5 items-center text-sm">
        {rows.map((r) => {
          const sign = r.deltaPctPoints > 0 ? "+" : "";
          const accent = positive ? "text-positive" : "text-negative";
          return (
            <Link
              key={r.key}
              to={`/municipality/${r.key}`}
              underline={false}
              className="contents"
            >
              <span className="truncate font-medium">{r.name}</span>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {r.priorPct !== undefined ? formatPct(r.priorPct, 1) : "—"} →{" "}
                {formatPct(r.currentPct, 1)}
              </span>
              <span
                className={`tabular-nums text-xs font-semibold text-right ${accent}`}
              >
                {sign}
                {r.deltaPctPoints.toFixed(2)}pp
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_party_swings_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4" />
              <span>{t("dashboard_party_swings")}</span>
            </div>
          </Hint>
        </div>
      }
      className="min-h-[280px]"
    >
      <div className="grid gap-6 md:grid-cols-2 mt-2">
        {renderColumn(gainers, t("dashboard_party_swing_gainers"), true)}
        {renderColumn(losers, t("dashboard_party_swing_losers"), false)}
      </div>
    </StatCard>
  );
};
