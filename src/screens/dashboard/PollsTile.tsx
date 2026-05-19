import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Target } from "lucide-react";
import { useElectionContext } from "@/data/ElectionContext";
import {
  useAgencies,
  usePollsAccuracy,
  usePollsAnalysis,
} from "@/data/polls/usePolls";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { Hint } from "@/ux/Hint";
import { Link } from "@/ux/Link";
import { StatCard } from "./StatCard";
import { partyHref } from "@/lib/utils";

export const PollsTile: FC = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { selected } = useElectionContext();
  const { data: accuracy } = usePollsAccuracy();
  const { data: agencies } = useAgencies();
  const { data: analysis } = usePollsAnalysis();
  const { colorFor, displayNameFor } = useCanonicalParties();

  const electionIso = selected?.replace(/_/g, "-");

  const { entry, headline } = useMemo(() => {
    if (!accuracy || !electionIso) return { entry: null, headline: null };
    const e = accuracy.elections.find((x) => x.electionDate === electionIso);
    if (!e) return { entry: null, headline: null };
    const agencies = [...e.agencies].sort((a, b) => a.mae - b.mae);
    const narrative = analysis?.byElection?.[electionIso];
    const lines = isBg ? narrative?.headlines.bg : narrative?.headlines.en;
    const headline = lines?.[0] ?? null;
    return { entry: { ...e, agencies }, headline };
  }, [accuracy, electionIso, analysis, isBg]);

  if (!entry || !agencies) return null;

  const agencyById = new Map(agencies.map((a) => [a.id, a]));
  const maxMae = Math.max(0.01, ...entry.agencies.map((a) => a.mae));

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_polls_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              <span>{t("polls_title")}</span>
            </div>
          </Hint>
          <Link
            to="/polls"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
    >
      {headline ? (
        <p className="text-sm leading-relaxed mt-1 text-muted-foreground">
          {headline}
        </p>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(160px,4fr)_auto_auto_minmax(0,1.2fr)] gap-x-3 gap-y-1.5 items-center mt-3 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("polls_agency")}
        </span>
        <span />
        <Hint text={t("dashboard_polls_mae_hint")} underline={false}>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
            MAE
          </span>
        </Hint>
        <Hint text={t("dashboard_polls_days_before_hint")} underline={false}>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
            {t("polls_days_before")}
          </span>
        </Hint>
        <Hint text={t("dashboard_polls_biggest_miss_hint")} underline={false}>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("polls_biggest_miss")}
          </span>
        </Hint>
        {entry.agencies.map((a) => {
          const ag = agencyById.get(a.agencyId);
          const name = ag ? (isBg ? ag.name_bg : ag.name_en) : a.agencyId;
          const widthPct = Math.max(2, (a.mae / maxMae) * 100);
          const hue = Math.max(0, 140 - a.mae * 30);
          const sign = a.biggestMiss.error > 0 ? "+" : "";
          const missColor =
            a.biggestMiss.error > 0 ? "text-emerald-600" : "text-rose-600";
          return (
            <div className="contents" key={a.agencyId}>
              <Link
                to={`/polls/${a.agencyId}`}
                className="font-medium truncate hover:underline"
                underline={false}
              >
                {name}
              </Link>
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
                {a.mae.toFixed(2)}
              </span>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {a.daysBefore}d
              </span>
              <span className="text-xs truncate flex items-center gap-1.5 min-w-0">
                <Link
                  to={partyHref(a.biggestMiss.key)}
                  className="inline-flex items-center gap-1 font-medium hover:underline min-w-0"
                  underline={false}
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{
                      backgroundColor: colorFor(a.biggestMiss.key) || "#888",
                    }}
                  />
                  <span className="truncate">
                    {displayNameFor(a.biggestMiss.key) ?? a.biggestMiss.key}
                  </span>
                </Link>
                <span
                  className={`tabular-nums font-semibold shrink-0 ${missColor}`}
                >
                  {sign}
                  {a.biggestMiss.error.toFixed(1)}pp
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </StatCard>
  );
};
