// The two cards that open „Социологически проучвания" on `/presidential/:cycle` — the
// presidential twins of the parliamentary dashboard's `PollsTile` and `AccuracyTrendsTile`, built
// the same way so the two pages read as one product: an agency leaderboard (MAE bar, days before
// the vote, biggest miss) and the cross-agency average MAE per election as bars.
//
// ⚠ THE GRADE IS THE ANALYZER'S `agencies` projection, which grades by the PARLIAMENTARY rule
// (`parliamentaryRuleAgencies` in scripts/polls/presidential/analyze_accuracy.ts) — so an agency
// is graded the same way on both dashboards. It is a ROUND-ONE grade on every view, which is why
// the headline names the round. The stricter question-level comparisons stay in the explorer.
//
// ⚠ A FAILED FETCH IS AN ALERT WITH A RETRY, never the „not verified yet" sentence — a fetch
// error must not read as an unscored election. Only the leaderboard reports it; the trend card
// reads the same query and stays silent so one failure is one alert.

import { FC, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Activity, Target } from "lucide-react";
import { usePresidentialPollsAccuracy } from "@/data/presidential/usePresidentialPolls";
import { agencyDisplayName, useAgencies } from "@/data/polls/useAgencies";
import type { PresidentialAgencyError } from "@/data/polls/pollsTypes";
import { presidentialUrl } from "@/data/elections/presidentialRoutes";
import { presidentialTrendRows } from "@/data/presidential/presidentialPollAccuracy";
import { localDate } from "@/data/utils";
import { formatDecimal, formatPct } from "@/lib/currency";
import { StatCard } from "@/screens/dashboard/StatCard";
import { missColorClass, missSign } from "@/screens/dashboard/agencyMaeBar";
import { MaeBar } from "@/screens/dashboard/MaeBar";
import {
  AccuracyTrendsBars,
  type AccuracyTrendRow,
} from "@/screens/polls/AccuracyTrendsBars";
import { Hint } from "@/ux/Hint";
import { Link } from "@/ux/Link";
import { PresidentialPersonName } from "./PresidentialPersonName";

/** Opens the presidential polls hub filtered to this cycle — the campaign explorer lives there. */
const SeeDetails: FC<{ cycle: string }> = ({ cycle }) => {
  const { t } = useTranslation();
  return (
    <Link
      to={{ pathname: "/polls/presidential", search: { pollCycle: cycle } }}
      className="text-[10px] normal-case text-primary hover:underline"
      underline={false}
    >
      {t("dashboard_see_details")} →
    </Link>
  );
};

/** A miss on „други" / „не подкрепям никого" is not a person and must never become a link. */
const MissName: FC<{ a: PresidentialAgencyError }> = ({ a }) => {
  const row = a.errors.find((e) => e.key === a.biggestMiss.key);
  const name = row?.name_bg ?? a.biggestMiss.key;
  return a.biggestMiss.key !== "други" && a.biggestMiss.key !== "none" ? (
    <PresidentialPersonName name={name} />
  ) : (
    <span className="font-medium truncate">{name}</span>
  );
};

export const PresidentialPollsTile: FC<{ cycle: string }> = ({ cycle }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const aq = usePresidentialPollsAccuracy();
  const { data: agencyList } = useAgencies();

  if (aq.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("pp_history_loading")}
      </p>
    );
  if (aq.isError)
    return (
      <div role="alert" className="text-sm">
        {t("pp_history_load_error")}{" "}
        <button
          type="button"
          className="underline text-primary"
          onClick={() => void aq.refetch()}
        >
          {t("pp_history_retry")}
        </button>
      </div>
    );
  const entry = aq.data?.cycles.find((c) => c.cycle === cycle);
  const agencies = entry
    ? [...entry.agencies].sort((a, b) => a.mae - b.mae)
    : [];
  const maxMae = Math.max(0.01, ...agencies.map((a) => a.mae));
  const nameOf = (id: string) => agencyDisplayName(agencyList, id, isBg);
  const best = agencies[0];
  const winner = entry?.actualResults[0];

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("presidential_polls_tile_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              <span>{t("polls_title")}</span>
            </div>
          </Hint>
          <SeeDetails cycle={cycle} />
        </div>
      }
    >
      {!best ? (
        <p className="text-sm mt-1 text-muted-foreground">
          {t("presidential_polls_unscored")}
        </p>
      ) : (
        <>
          <p className="text-sm leading-relaxed mt-1 text-muted-foreground">
            {t("presidential_polls_headline", {
              agency: nameOf(best.agencyId),
              mae: formatDecimal(best.mae, i18n.language),
              days: best.daysBefore,
              winner: winner?.name_bg ?? "",
              pct: winner ? formatPct(winner.pct / 100, i18n.language, 2) : "",
            })}
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(160px,4fr)_auto_auto_minmax(0,1.4fr)] gap-x-3 gap-y-1.5 items-center mt-3 text-sm">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("polls_agency")}
            </span>
            <span />
            <Hint text={t("presidential_polls_mae_hint")} underline={false}>
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
                MAE
              </span>
            </Hint>
            <Hint
              text={t("dashboard_polls_days_before_hint")}
              underline={false}
            >
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
                {t("polls_days_before")}
              </span>
            </Hint>
            <Hint
              text={t("presidential_polls_biggest_miss_hint")}
              underline={false}
            >
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("polls_biggest_miss")}
              </span>
            </Hint>
            {agencies.map((a) => {
              return (
                <div className="contents" key={a.agencyId}>
                  <Link
                    to={`/polls/${a.agencyId}/presidential`}
                    className="font-medium truncate hover:underline"
                    underline={false}
                  >
                    {nameOf(a.agencyId)}
                  </Link>
                  <MaeBar mae={a.mae} maxMae={maxMae} />
                  <span className="tabular-nums text-xs font-semibold text-right">
                    {a.mae.toFixed(2)}
                  </span>
                  <span className="tabular-nums text-xs text-muted-foreground text-right">
                    {a.daysBefore}d
                  </span>
                  <span className="text-xs flex items-center gap-1.5 min-w-0">
                    <span className="truncate min-w-0">
                      <MissName a={a} />
                    </span>
                    <span
                      className={`tabular-nums font-semibold shrink-0 ${missColorClass(a.biggestMiss.error)}`}
                    >
                      {missSign(a.biggestMiss.error)}
                      {a.biggestMiss.error.toFixed(1)}pp
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </StatCard>
  );
};

/** Cross-agency average MAE per presidential election — the parliamentary
 *  „Тенденции в точността" chart, drawn by the same `AccuracyTrendsBars`. */
export const PresidentialPollsTrendTile: FC<{ cycle: string }> = ({
  cycle,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const aq = usePresidentialPollsAccuracy();

  const rows = useMemo<(AccuracyTrendRow & { cycle: string })[]>(
    () =>
      presidentialTrendRows(aq.data?.cycles ?? []).map((r) => ({
        ...r,
        label: localDate(r.date.replace(/-/g, "_")),
        isSelected: r.cycle === cycle,
      })),
    [aq.data, cycle],
  );

  const goToCycle = useCallback(
    (date: string) => {
      const target = rows.find((r) => r.date === date);
      const url = target ? presidentialUrl(target.cycle, "country") : null;
      if (url) navigate(url);
    },
    [rows, navigate],
  );

  // The chart's own guard, so the card chrome never renders around nothing.
  if (rows.length < 2) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("presidential_polls_trend_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              <span>{t("dashboard_accuracy_trends")}</span>
            </div>
          </Hint>
          <SeeDetails cycle={cycle} />
        </div>
      }
      className="overflow-hidden"
    >
      <AccuracyTrendsBars rows={rows} onSelect={goToCycle} />
    </StatCard>
  );
};
