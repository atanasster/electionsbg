import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Target, Scale } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { Hint } from "@/ux/Hint";
import { Agency, ElectionAccuracy } from "@/data/polls/pollsTypes";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { localDate } from "@/data/utils";

type Props = {
  election: ElectionAccuracy;
  agencies: Agency[];
};

export const PollsLatestElectionTile: FC<Props> = ({ election, agencies }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { displayNameFor } = useCanonicalParties();
  const agencyById = new Map(agencies.map((a) => [a.id, a]));

  const sorted = useMemo(
    () => [...election.agencies].sort((a, b) => a.mae - b.mae),
    [election],
  );
  const maxMae = Math.max(0.01, ...sorted.map((a) => a.mae));
  const dateStr = localDate(election.electionDate.replace(/-/g, "_"));

  return (
    <StatCard
      label={
        <Hint text={t("polls_election_accuracy_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            <span>
              {t("polls_election_accuracy")} — {dateStr}
            </span>
          </div>
        </Hint>
      }
    >
      <div className="grid grid-cols-[auto_minmax(0,1.6fr)_auto_auto] sm:grid-cols-[auto_minmax(0,1fr)_minmax(160px,4fr)_auto_auto_minmax(0,1.2fr)] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          #
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("polls_agency")}
        </span>
        <span className="hidden sm:block" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          MAE
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right whitespace-normal leading-tight">
          {t("polls_days_before")}
        </span>
        <span className="hidden sm:block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("polls_biggest_miss")}
        </span>
        {sorted.map((a, idx) => {
          const ag = agencyById.get(a.agencyId);
          const name = ag ? (isBg ? ag.name_bg : ag.name_en) : a.agencyId;
          const widthPct = Math.max(2, (a.mae / maxMae) * 100);
          const hue = Math.max(0, 140 - a.mae * 30);
          const missColor =
            a.biggestMiss.error > 0 ? "text-emerald-600" : "text-rose-600";
          const sign = a.biggestMiss.error > 0 ? "+" : "";
          return (
            <Link
              to={`/polls/${a.agencyId}`}
              className="contents group"
              key={a.agencyId}
            >
              <span className="tabular-nums text-xs text-muted-foreground">
                {idx + 1}
              </span>
              <span className="font-medium truncate text-primary group-hover:underline">
                {name}
              </span>
              <div className="hidden sm:block relative h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="absolute top-0 bottom-0 left-0 rounded-full"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: `hsl(${hue} 70% 45%)`,
                  }}
                />
              </div>
              <span className="flex items-center justify-end gap-1 tabular-nums text-xs font-semibold">
                {a.normalization?.applied ? (
                  <Hint
                    text={t("polls_normalization_applied", {
                      pp: a.normalization.redistributed.toFixed(1),
                    })}
                    underline={false}
                  >
                    <Scale className="h-3 w-3 text-muted-foreground" />
                  </Hint>
                ) : null}
                {a.mae.toFixed(2)}
              </span>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {a.daysBefore}d
              </span>
              <span className="hidden sm:block text-xs truncate">
                <span className="font-medium">
                  {displayNameFor(a.biggestMiss.key) ?? a.biggestMiss.key}
                </span>{" "}
                <span className={`tabular-nums font-semibold ${missColor}`}>
                  {sign}
                  {a.biggestMiss.error.toFixed(1)}pp
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </StatCard>
  );
};
