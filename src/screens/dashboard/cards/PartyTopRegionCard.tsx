import { FC } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { PartyDashboardSummary } from "@/data/dashboard/partyDashboardTypes";
import { formatPct, formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { StatCard } from "../StatCard";

type Props = { data: PartyDashboardSummary };

export const PartyTopRegionCard: FC<Props> = ({ data }) => {
  const { t, i18n } = useTranslation();
  const top = data.topRegion;
  const topName = top
    ? i18n.language === "bg"
      ? top.long_name || top.name || top.key
      : top.long_name_en || top.name_en || top.name || top.key
    : undefined;
  if (!top) {
    return (
      <StatCard
        label={t("dashboard_party_top_region")}
        hint={t("dashboard_party_top_region_hint")}
      >
        <div className="text-sm text-muted-foreground">
          {t("dashboard_no_data")}
        </div>
      </StatCard>
    );
  }
  return (
    <StatCard
      label={t("dashboard_party_top_region")}
      hint={t("dashboard_party_top_region_hint")}
    >
      <div className="flex items-baseline gap-2">
        <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
        <Link
          to={`/municipality/${top.key}`}
          className="text-2xl font-bold truncate hover:underline"
          underline={false}
        >
          {topName}
        </Link>
      </div>
      <div className="text-sm font-medium tabular-nums text-muted-foreground">
        {formatThousands(top.totalVotes)} {t("votes").toLowerCase()} ·{" "}
        {formatPct(top.pctOfPartyTotal, 1)} {t("dashboard_of_party_total")}
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        #{top.position} {t("dashboard_in_region")} ·{" "}
        {formatPct(top.pctOfLocation, 2)} {t("dashboard_of_region_vote")}
      </div>
    </StatCard>
  );
};
