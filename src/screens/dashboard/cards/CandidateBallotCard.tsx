import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ListOrdered } from "lucide-react";
import { CandidateDashboardSummary } from "@/data/dashboard/candidateDashboardTypes";
import { Link } from "@/ux/Link";
import { StatCard } from "../StatCard";

type Props = { data: CandidateDashboardSummary };

export const CandidateBallotCard: FC<Props> = ({ data }) => {
  const { t, i18n } = useTranslation();
  const regions = data.regions;
  if (!regions.length) {
    return (
      <StatCard
        label={t("dashboard_candidate_ballot")}
        hint={t("dashboard_candidate_ballot_hint")}
      >
        <div className="text-sm text-muted-foreground">
          {t("dashboard_no_data")}
        </div>
      </StatCard>
    );
  }
  return (
    <StatCard
      label={t("dashboard_candidate_ballot")}
      hint={t("dashboard_candidate_ballot_hint")}
    >
      <div className="flex items-baseline gap-2">
        <ListOrdered className="h-5 w-5 text-muted-foreground shrink-0" />
        <span className="text-2xl font-bold tabular-nums">
          #{regions[0]?.pref ?? "—"}
        </span>
        {regions.length > 1 && (
          <span className="text-xs text-muted-foreground">
            +{regions.length - 1} {t("dashboard_more_regions")}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5 mt-1">
        {regions.map((r) => {
          const name =
            i18n.language === "bg"
              ? r.long_name || r.name || r.oblast
              : r.long_name_en || r.name_en || r.oblast;
          return (
            <div
              key={`${r.oblast}-${r.pref}`}
              className="flex items-baseline gap-2 text-sm"
            >
              <span className="tabular-nums text-xs text-muted-foreground">
                #{r.pref}
              </span>
              <Link
                to={`/municipality/${r.oblast}`}
                className="font-medium truncate hover:underline"
                underline={false}
              >
                {name}
              </Link>
            </div>
          );
        })}
      </div>
    </StatCard>
  );
};
