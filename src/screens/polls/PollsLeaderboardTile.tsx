import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Trophy } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { Hint } from "@/ux/Hint";
import { Agency, AgencyProfile } from "@/data/polls/pollsTypes";

type Props = { profiles: AgencyProfile[]; agencies: Agency[] };

export const PollsLeaderboardTile: FC<Props> = ({ profiles, agencies }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const agencyById = new Map(agencies.map((a) => [a.id, a]));

  const maxMae = Math.max(0.01, ...profiles.map((p) => p.overallMAE));

  return (
    <StatCard
      label={
        <Hint text={t("polls_leaderboard_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            <span>{t("polls_leaderboard")}</span>
          </div>
        </Hint>
      }
    >
      <div className="grid grid-cols-[auto_minmax(0,1.6fr)_minmax(80px,1fr)_auto_auto_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          #
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("polls_agency")}
        </span>
        <span />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          MAE
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          RMSE
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("polls_elections")}
        </span>
        {profiles.map((p, idx) => {
          const a = agencyById.get(p.agencyId);
          const name = a ? (isBg ? a.name_bg : a.name_en) : p.agencyId;
          const widthPct = Math.max(2, (p.overallMAE / maxMae) * 100);
          // Lower MAE = better. Map 0–4pp to green→amber for the bar tint.
          const hue = Math.max(0, 140 - p.overallMAE * 30);
          return (
            <Link
              to={`/polls/${p.agencyId}`}
              className="contents group"
              key={p.agencyId}
            >
              <span className="tabular-nums text-xs text-muted-foreground">
                {idx + 1}
              </span>
              <span className="font-medium truncate text-primary group-hover:underline">
                {name}
              </span>
              <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="absolute top-0 bottom-0 left-0 rounded-full"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: `hsl(${hue} 70% 45%)`,
                  }}
                />
              </div>
              <span className="tabular-nums text-xs font-semibold text-right">
                {p.overallMAE.toFixed(2)}
              </span>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {p.overallRMSE.toFixed(2)}
              </span>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {p.electionsCovered.length}
              </span>
            </Link>
          );
        })}
      </div>
    </StatCard>
  );
};
