import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { PartyDashboardSummary } from "@/data/dashboard/partyDashboardTypes";
import { useRegions } from "@/data/regions/useRegions";
import { formatPct, formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

const TOP_N = 10;

const DeltaBadge: FC<{ delta?: number; suffix?: string }> = ({
  delta,
  suffix = "pp",
}) => {
  if (delta === undefined)
    return <span className="text-xs text-muted-foreground">—</span>;
  const sign = delta > 0 ? "+" : "";
  const color =
    delta > 0
      ? "text-positive"
      : delta < 0
        ? "text-negative"
        : "text-muted-foreground";
  return (
    <span className={`tabular-nums text-xs font-medium ${color}`}>
      {sign}
      {delta.toFixed(2)}
      {suffix}
    </span>
  );
};

type Props = { data: PartyDashboardSummary };

export const PartyTopRegionsTile: FC<Props> = ({ data }) => {
  const { t, i18n } = useTranslation();
  const { findRegion } = useRegions();

  const rows = useMemo(() => {
    const sorted = [...data.regions].slice(0, TOP_N);
    const maxVotes = sorted[0]?.totalVotes ?? 1;
    const color = data.color ?? "#888";
    return sorted.map((r) => {
      const info = findRegion(r.oblast);
      const name =
        i18n.language === "bg"
          ? info?.long_name || info?.name || r.oblast
          : info?.long_name_en || info?.name_en || r.oblast;
      const swing = data.swings.find((s) => s.key === r.key);
      return {
        key: r.key,
        name,
        totalVotes: r.totalVotes,
        position: r.position,
        pctOfRegion: r.pctOfLocation,
        pctOfPartyTotal: r.pctOfPartyTotal,
        deltaPctPoints: swing?.deltaPctPoints,
        barPct: (r.totalVotes / maxVotes) * 100,
        color,
      };
    });
  }, [data, findRegion, i18n.language]);

  if (rows.length === 0) return null;
  const totalCount = data.regions.length;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_party_top_regions_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              <span>{t("dashboard_party_top_regions")}</span>
            </div>
          </Hint>
          {totalCount > TOP_N ? (
            <Link
              to={`/party/${data.nickName}/regions`}
              className="text-[10px] normal-case text-primary hover:underline"
              underline={false}
            >
              {t("dashboard_see_details")} →
            </Link>
          ) : null}
        </div>
      }
      className="overflow-hidden"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_minmax(80px,1.5fr)_auto_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("region")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("votes")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("position")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_share_of_party")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_pct_of_region")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_change")}
        </span>
        {rows.map((r) => (
          <Link
            key={r.key}
            to={`/municipality/${r.key}`}
            underline={false}
            className="contents"
          >
            <span className="truncate font-medium">{r.name}</span>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {formatThousands(r.totalVotes)}
            </span>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              #{r.position}
            </span>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, r.barPct)}%`,
                  backgroundColor: r.color,
                }}
              />
            </div>
            <span className="tabular-nums text-xs font-semibold text-right">
              {formatPct(r.pctOfRegion, 2)}
            </span>
            <span className="justify-self-end">
              <DeltaBadge delta={r.deltaPctPoints} />
            </span>
          </Link>
        ))}
      </div>
    </StatCard>
  );
};
