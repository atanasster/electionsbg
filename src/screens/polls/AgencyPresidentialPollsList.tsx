// The presidential twin of `AgencyPollsList.tsx`, for the `/polls/:agencyId`
// page — Tier 4 T4.4 Increment B (docs/plans/polls-agency-watchers-v1.md §11
// item 3). Rendered only when the agency has at least one presidential poll
// (the caller's own guard, matching `PollsAgencyScreen.tsx`'s existing
// `agencyPolls.length > 0` gate for the parliamentary list).
//
// ⚠ NO ACTUAL-VS-POLLED COMPARISON, unlike the parliamentary list. That
// comparison needs a SCORED poll (a cycle accepted into `accuracy.json`),
// and the presidential corpus has none yet — GM's own real capture carries
// `cycle: null`. Building the comparison UI now would be "UI for data that
// does not exist yet", the scope cut `PresidentialPollsTile.tsx`'s own
// header already states for `AccuracyTrendsTile`. This shows POLLED support
// only, newest fieldwork first.
//
// ⚠ CANDIDATE NAMES ARE NEVER TRANSLATED, matching every other presidential
// surface (`PresidentialTicketRanking`, `PresidentialPollsTile`) — a
// candidate's name is shown in Bulgarian regardless of interface language.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, ListOrdered } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { Poll, PresidentialPollDetail, Runoff } from "@/data/polls/pollsTypes";
import { localizeFieldwork, sortByFieldworkDesc } from "@/data/polls/fieldwork";
import { groupByPollSortedBySupport } from "@/data/polls/pollRows";
import { isNamedCandidateRow } from "@/data/polls/presidentialRow";
import { PresidentialPersonName } from "@/screens/presidential/PresidentialPersonName";

type Props = {
  polls: Poll[];
  details: PresidentialPollDetail[];
  runoffs: Runoff[];
};

export const AgencyPresidentialPollsList: FC<Props> = ({
  polls,
  details,
  runoffs,
}) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";

  const detailsByPoll = useMemo(
    () => groupByPollSortedBySupport(details),
    [details],
  );

  const runoffsByPoll = useMemo(() => {
    const m = new Map<string, Runoff[]>();
    for (const r of runoffs) {
      const arr = m.get(r.pollId);
      if (arr) arr.push(r);
      else m.set(r.pollId, [r]);
    }
    return m;
  }, [runoffs]);

  const sortedPolls = useMemo(() => sortByFieldworkDesc(polls), [polls]);

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <ListOrdered className="h-4 w-4" />
          <span>
            {t("polls_presidential_polls")} ({sortedPolls.length})
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-3 mt-1">
        {sortedPolls.map((p) => {
          const ds = detailsByPoll.get(p.id) ?? [];
          const rs = runoffsByPoll.get(p.id) ?? [];
          // ⚠ A `Runoff`'s `a`/`b` are `CandidateKey`s, not names — resolved back to a
          // display name through this SAME poll's own detail rows, since `Runoff` itself
          // carries no raw name field (the documented re-resolution gap). A key absent from
          // this poll's own rows renders literally rather than guessing at a name.
          const nameForKey = new Map(
            ds.map((d) => [d.candidateKey, d.candidateName_bg]),
          );
          const methodology = isBg ? p.methodology.bg : p.methodology.en;
          const showMethodology = methodology && methodology !== "N/A";
          const maxSupport = Math.max(2, ...ds.map((d) => d.support));
          return (
            <div
              key={p.id}
              className="rounded-lg border bg-background/50 p-3 flex flex-col gap-2"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                <span className="font-semibold text-sm">
                  {localizeFieldwork(p.fieldwork, isBg)}
                </span>
                {p.respondents ? (
                  <span className="text-muted-foreground tabular-nums">
                    n={p.respondents.toLocaleString()}
                  </span>
                ) : null}
                {p.source ? (
                  <a
                    href={p.source}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-auto text-primary hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t("polls_source")}
                  </a>
                ) : null}
              </div>
              {showMethodology ? (
                <div className="text-[11px] text-muted-foreground italic">
                  {methodology}
                </div>
              ) : null}
              <div className="flex flex-col gap-1">
                {ds.map((d) => {
                  const widthPct = Math.max(2, (d.support / maxSupport) * 100);
                  return (
                    <div
                      key={d.candidateKey}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(80px,2fr)_auto] gap-x-3 items-center text-xs"
                    >
                      {isNamedCandidateRow(d) ? (
                        <PresidentialPersonName name={d.candidateName_bg} />
                      ) : (
                        <span className="font-medium truncate">
                          {d.candidateName_bg}
                        </span>
                      )}
                      <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="absolute top-0 bottom-0 left-0 rounded-full bg-primary/70"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                      <span className="tabular-nums font-semibold w-12 text-right">
                        {d.support.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
              {rs.length > 0 ? (
                <div className="flex flex-col gap-0.5 mt-1 text-xs text-muted-foreground">
                  {rs.map((r) => (
                    <div key={`${r.a}-${r.b}`}>
                      <PresidentialPersonName
                        name={nameForKey.get(r.a) ?? r.a}
                      />
                      {" — "}
                      <span className="tabular-nums font-semibold">
                        {r.supportA.toFixed(1)}%
                      </span>
                      {" / "}
                      <PresidentialPersonName
                        name={nameForKey.get(r.b) ?? r.b}
                      />
                      {" — "}
                      <span className="tabular-nums font-semibold">
                        {r.supportB.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </StatCard>
  );
};
