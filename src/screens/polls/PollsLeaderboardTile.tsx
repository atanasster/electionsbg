import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Trophy } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { Hint } from "@/ux/Hint";
import { Agency, AgencyGrade, AgencyProfile } from "@/data/polls/pollsTypes";

const GRADE_STYLE: Record<AgencyGrade, string> = {
  "A+": "bg-emerald-600 text-white",
  A: "bg-emerald-500 text-white",
  "B+": "bg-lime-500 text-white",
  B: "bg-amber-400 text-foreground",
  "C+": "bg-amber-500 text-white",
  C: "bg-orange-500 text-white",
  D: "bg-rose-500 text-white",
  F: "bg-rose-700 text-white",
};

type Props = { profiles: AgencyProfile[]; agencies: Agency[] };

export const PollsLeaderboardTile: FC<Props> = ({ profiles, agencies }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const agencyById = new Map(agencies.map((a) => [a.id, a]));

  const maxMae = Math.max(0.01, ...profiles.map((p) => p.shrunkMAEAdjusted));

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
      <div
        className="
          grid items-center mt-1 text-sm gap-x-3 gap-y-1.5
          grid-cols-[auto_minmax(0,1.4fr)_auto_auto_auto]
          md:grid-cols-[auto_minmax(0,1.4fr)_auto_minmax(80px,1fr)_auto_auto_auto]
          lg:grid-cols-[auto_minmax(0,1.4fr)_auto_minmax(80px,1fr)_auto_auto_auto_auto_auto]
        "
      >
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          #
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("polls_agency")}
        </span>
        <Hint text={t("polls_grade_hint")} underline={false}>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-center">
            {t("polls_grade")}
          </span>
        </Hint>
        <span className="hidden md:block" />
        <Hint text={t("polls_shrunk_mae_hint")} underline={false}>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right whitespace-normal leading-tight">
            {t("polls_shrunk_mae")}
          </span>
        </Hint>
        <Hint text={t("polls_plus_minus_hint")} underline={false}>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right whitespace-normal leading-tight">
            {t("polls_plus_minus")}
          </span>
        </Hint>
        <span className="hidden md:block">
          <Hint text={t("polls_barrier_call_hint")} underline={false}>
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right whitespace-normal leading-tight">
              {t("polls_barrier_call")}
            </span>
          </Hint>
        </span>
        <span className="hidden lg:block text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("polls_elections")}
        </span>
        <span className="hidden lg:block">
          <Hint text={t("polls_median_days_before_hint")} underline={false}>
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right whitespace-normal leading-tight">
              {t("polls_median_days_before")}
            </span>
          </Hint>
        </span>

        {profiles.map((p, idx) => {
          const a = agencyById.get(p.agencyId);
          const name = a ? (isBg ? a.name_bg : a.name_en) : p.agencyId;
          const widthPct = Math.max(2, (p.shrunkMAEAdjusted / maxMae) * 100);
          // Adjusted-MAE colour scale: green at the cross-agency mean (~1.0),
          // amber near the C+/D boundary (~1.5), red past F (~2.0).
          const hue = Math.max(0, 140 - (p.shrunkMAEAdjusted - 0.5) * 80);
          const pmColor =
            p.plusMinus === null
              ? "text-muted-foreground"
              : p.plusMinus > 0
                ? "text-emerald-600"
                : "text-rose-600";
          const pmText =
            p.plusMinus === null
              ? "—"
              : `${p.plusMinus > 0 ? "+" : ""}${p.plusMinus.toFixed(2)}`;
          const barrierText =
            p.barrierCallRate === null
              ? "—"
              : `${Math.round(p.barrierCallRate * 100)}%`;
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
              <span
                className={`px-2 py-0.5 rounded-md text-xs font-bold tabular-nums text-center min-w-[32px] ${GRADE_STYLE[p.grade]}`}
              >
                {p.grade}
              </span>
              <div className="hidden md:block relative h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="absolute top-0 bottom-0 left-0 rounded-full"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: `hsl(${hue} 70% 45%)`,
                  }}
                />
              </div>
              <span className="tabular-nums text-xs font-semibold text-right">
                {p.shrunkMAEAdjusted.toFixed(2)}
              </span>
              <span
                className={`tabular-nums text-xs font-semibold text-right ${pmColor}`}
              >
                {pmText}
              </span>
              <span className="hidden md:block tabular-nums text-xs text-muted-foreground text-right">
                {barrierText}
              </span>
              <span className="hidden lg:block tabular-nums text-xs text-muted-foreground text-right">
                {p.electionsCovered.length}
              </span>
              <span className="hidden lg:block tabular-nums text-xs text-muted-foreground text-right">
                {p.medianDaysBefore != null ? `${p.medianDaysBefore}d` : "—"}
              </span>
            </Link>
          );
        })}
      </div>
    </StatCard>
  );
};
