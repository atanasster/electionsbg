// Country-home tile: snapshot of Bulgaria's local government, anchored in time
// to the selected parliamentary election — it shows the most recent regular
// local-elections cycle that had already concluded by the selected date (so
// selecting the Oct-2022 vote surfaces mi2019, not mi2023).
//
// Surfaces three things at a glance:
//   1. Mayors won by party — top 5 with Δ vs the prior cycle.
//   2. Council vote share — top 4 with Δ vs the prior cycle.
//   3. Most-recent partial (chmi) election as a small "since {date}" chip,
//      since partials never appear in the elections selector.
//
// Reuses the same /<cycle>/index.json fetched on the /local/<cycle> page
// (queryKey "local_election_index"), so a user who clicks through gets a
// cached navigation. Auto-hides when the cycle has no data.
//
// Mounted under a "local_government" section on DashboardCards.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, Landmark } from "lucide-react";
import { useLocalElectionIndex } from "@/data/local/useLocalElectionIndex";
import { useLatestLocalCycle } from "@/data/local/useLatestLocalCycle";
import { usePriorLocalCycle } from "@/data/local/useLocalCycles";
import { useChmiHistoryAll } from "@/data/local/useChmiHistory";
import { friendlyCycleDate } from "@/data/local/cycleDate";
import { StatCard } from "./StatCard";

export const CountryLocalGovernmentTile: FC<{ className?: string }> = ({
  className,
}) => {
  const { t, i18n } = useTranslation();
  const cycle = useLatestLocalCycle();
  const { data: index } = useLocalElectionIndex(cycle);
  const priorCycle = usePriorLocalCycle(cycle);
  const { data: priorIndex } = useLocalElectionIndex(priorCycle);
  const { data: chmi } = useChmiHistoryAll();

  const cycleDate = friendlyCycleDate(cycle);

  const topMayors = useMemo(() => {
    if (!index?.mayorsByCanonical) return [];
    const priorByCanon = new Map(
      (priorIndex?.mayorsByCanonical ?? []).map((p) => [p.canonicalId, p]),
    );
    return [...index.mayorsByCanonical]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((p) => {
        const prior = priorByCanon.get(p.canonicalId);
        return { ...p, delta: prior ? p.count - prior.count : undefined };
      });
  }, [index, priorIndex]);

  const topCouncil = useMemo(() => {
    if (!index?.councilVoteShare) return [];
    const priorByCanon = new Map(
      (priorIndex?.councilVoteShare ?? []).map((p) => [p.canonicalId, p]),
    );
    return [...index.councilVoteShare]
      .sort((a, b) => b.pctOfValid - a.pctOfValid)
      .slice(0, 4)
      .map((p) => {
        const prior = priorByCanon.get(p.canonicalId);
        return {
          ...p,
          deltaPct: prior ? p.pctOfValid - prior.pctOfValid : undefined,
        };
      });
  }, [index, priorIndex]);

  // Most recent partial election anywhere in the country — used for the
  // "Partial elections since DD.MM.YYYY" chip. We pin only on events that
  // occurred AFTER the active regular cycle's R1 date.
  const partialSummary = useMemo(() => {
    if (!chmi || !index) return null;
    const cutoff = index.round1Date;
    const after = chmi.allEvents.filter((e) => e.date > cutoff);
    if (after.length === 0) return null;
    const sorted = [...after].sort((a, b) => b.date.localeCompare(a.date));
    return {
      count: after.length,
      latest: sorted[0].date,
    };
  }, [chmi, index]);

  if (!index) return null;

  const totalMayors = index.mayorsByCanonical.reduce(
    (acc, m) => acc + m.count,
    0,
  );

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Landmark className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("country_local_gov_title")} · {cycleDate}
            </span>
          </div>
          <Link
            to={`/local/${cycle}`}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case shrink-0"
          >
            {t("local_election_view_details")}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("country_local_gov_mayors_label", { count: totalMayors })}
          </div>
          <ul className="mt-1.5 flex flex-col gap-1">
            {topMayors.map((m) => (
              <li
                key={m.canonicalId}
                className="flex items-center gap-2 text-[12px]"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: m.color }}
                  aria-hidden
                />
                <span className="truncate flex-1" title={m.displayName}>
                  {m.displayName}
                </span>
                <span className="tabular-nums font-semibold">{m.count}</span>
                {m.delta !== undefined && m.delta !== 0 ? (
                  <span
                    className={
                      m.delta > 0
                        ? "text-emerald-600 font-medium tabular-nums"
                        : "text-rose-600 font-medium tabular-nums"
                    }
                  >
                    {m.delta > 0 ? `↑+${m.delta}` : `↓${m.delta}`}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("country_local_gov_council_label")}
          </div>
          <ul className="mt-1.5 flex flex-col gap-1">
            {topCouncil.map((p) => (
              <li
                key={p.canonicalId}
                className="flex items-center gap-2 text-[12px]"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: p.color }}
                  aria-hidden
                />
                <span className="truncate flex-1" title={p.displayName}>
                  {p.displayName}
                </span>
                <span className="tabular-nums font-semibold">
                  {p.pctOfValid.toFixed(1)}%
                </span>
                {p.deltaPct !== undefined && Math.abs(p.deltaPct) >= 0.1 ? (
                  <span
                    className={
                      p.deltaPct > 0
                        ? "text-emerald-600 font-medium tabular-nums"
                        : "text-rose-600 font-medium tabular-nums"
                    }
                  >
                    {p.deltaPct > 0
                      ? `↑+${p.deltaPct.toFixed(1)}`
                      : `↓${p.deltaPct.toFixed(1)}`}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {partialSummary ? (
        <div className="mt-3 pt-2 border-t text-[11px] text-muted-foreground">
          <Link
            to="/local/chmi"
            className="inline-flex items-center rounded-md border border-blue-500/40 bg-blue-50 px-1.5 py-0.5 font-medium uppercase tracking-wide text-blue-700 mr-1.5 hover:underline"
          >
            {t("country_local_gov_partials_chip")}
          </Link>
          <span>
            {t("country_local_gov_partials_summary", {
              count: partialSummary.count,
              date: new Date(partialSummary.latest).toLocaleDateString(
                i18n.language === "bg" ? "bg-BG" : "en-GB",
                { day: "2-digit", month: "2-digit", year: "numeric" },
              ),
            })}
          </span>
        </div>
      ) : null}
    </StatCard>
  );
};
