import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Target } from "lucide-react";
import { useAgencies, usePollsAccuracy } from "@/data/polls/usePolls";
import { useElectionContext } from "@/data/ElectionContext";
import { PartyDashboardSummary } from "@/data/dashboard/partyDashboardTypes";
import { localDate } from "@/data/utils";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

type Row = {
  agencyId: string;
  agencyName: string;
  polled: number;
  actual: number;
  error: number;
  fieldworkEnd: string;
  daysBefore: number;
};

type Props = { data: PartyDashboardSummary };

export const PartyAgencyForecastsTile: FC<Props> = ({ data }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { selected } = useElectionContext();
  const { data: accuracy } = usePollsAccuracy();
  const { data: agencies } = useAgencies();

  const rows = useMemo<Row[]>(() => {
    if (!accuracy) return [];
    const electionIso = selected.replace(/_/g, "-");
    const election = accuracy.elections.find(
      (e) => e.electionDate === electionIso,
    );
    if (!election) return [];
    const agencyById = new Map((agencies ?? []).map((a) => [a.id, a]));
    const out: Row[] = [];
    for (const ag of election.agencies) {
      const err = ag.errors.find((e) => e.key === data.nickName);
      if (!err) continue;
      const a = agencyById.get(ag.agencyId);
      const agencyName = a ? (isBg ? a.name_bg : a.name_en) : ag.agencyId;
      // Show the agency's *published* number (polledRaw when normalisation was
      // applied, else polled). The MAE leaderboard uses the normalised value
      // with a scale-icon indicator; here, per-agency per-party detail reads
      // most honestly as "what did the agency actually publish for this party".
      const rawPolled = err.polledRaw ?? err.polled;
      const rawError = Math.round((rawPolled - err.actual) * 100) / 100;
      out.push({
        agencyId: ag.agencyId,
        agencyName,
        polled: rawPolled,
        actual: err.actual,
        error: rawError,
        fieldworkEnd: ag.fieldworkEnd,
        daysBefore: ag.daysBefore,
      });
    }
    out.sort((a, b) => b.fieldworkEnd.localeCompare(a.fieldworkEnd));
    return out;
  }, [accuracy, agencies, selected, data.nickName, isBg]);

  if (rows.length === 0) return null;

  const dateStr = localDate(selected);

  return (
    <StatCard
      label={
        <Hint text={t("party_agency_forecasts_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            <span>
              {t("party_agency_forecasts_title")} — {dateStr}
            </span>
          </div>
        </Hint>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("polls_agency")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("party_agency_forecasts_polled")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("party_agency_forecasts_actual")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("party_agency_forecasts_diff")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("polls_days_before")}
        </span>
        {rows.map((r) => {
          const errColor = r.error > 0 ? "text-emerald-600" : "text-rose-600";
          const sign = r.error > 0 ? "+" : "";
          return (
            <Link
              to={`/polls/${r.agencyId}`}
              className="contents group"
              key={r.agencyId}
            >
              <span className="font-medium truncate text-primary group-hover:underline">
                {r.agencyName}
              </span>
              <span className="tabular-nums text-xs text-right">
                {r.polled.toFixed(1)}%
              </span>
              <span className="tabular-nums text-xs text-right text-muted-foreground">
                {r.actual.toFixed(1)}%
              </span>
              <span
                className={`tabular-nums text-xs font-semibold text-right ${errColor}`}
              >
                {sign}
                {r.error.toFixed(1)}pp
              </span>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {r.daysBefore}d
              </span>
            </Link>
          );
        })}
      </div>
    </StatCard>
  );
};
