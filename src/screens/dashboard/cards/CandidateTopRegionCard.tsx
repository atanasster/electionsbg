import { FC } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { CandidateDashboardSummary } from "@/data/dashboard/candidateDashboardTypes";
import { formatPct, formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { StatCard } from "../StatCard";

type Props = { data: CandidateDashboardSummary };

export const CandidateTopRegionCard: FC<Props> = ({ data }) => {
  const { t, i18n } = useTranslation();
  const top = data.regions[0];
  if (!top) {
    return (
      <StatCard
        label={t("dashboard_candidate_top_region")}
        hint={t("dashboard_candidate_top_region_hint")}
      >
        <div className="text-sm text-muted-foreground">
          {t("dashboard_no_data")}
        </div>
      </StatCard>
    );
  }
  const name =
    i18n.language === "bg"
      ? top.long_name || top.name || top.oblast
      : top.long_name_en || top.name_en || top.oblast;
  return (
    <StatCard
      label={t("dashboard_candidate_top_region")}
      hint={t("dashboard_candidate_top_region_hint")}
    >
      <div className="flex items-baseline gap-2">
        <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
        <Link
          to={`/municipality/${top.oblast}`}
          className="text-2xl font-bold truncate hover:underline"
          underline={false}
        >
          {name}
        </Link>
      </div>
      <div className="text-sm font-medium tabular-nums text-muted-foreground">
        {formatThousands(top.totalVotes)} {t("preferences").toLowerCase()}
        {top.pctOfPartyPrefs !== undefined && (
          <>
            {" · "}
            {formatPct(top.pctOfPartyPrefs, 1)} {t("dashboard_of_party_prefs")}
          </>
        )}
      </div>
      {top.pctOfRegion !== undefined && (
        <div className="text-xs text-muted-foreground tabular-nums">
          #{top.pref} {t("dashboard_on_ballot")} ·{" "}
          {formatPct(top.pctOfRegion, 2)} {t("dashboard_of_region_vote")}
        </div>
      )}
    </StatCard>
  );
};
