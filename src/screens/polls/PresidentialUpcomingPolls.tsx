// „Предстоящи избори" — every published poll for the next presidential election, before any
// result exists: one row per poll, the leading tickets as columns with a bar, each row's own base,
// and the undecided share where the agency published it inside that base. Selection and the
// reasons it refuses to average or grade live in `upcomingPresidentialPolls`.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock } from "lucide-react";
import type { Poll, PresidentialPollDetail } from "@/data/polls/pollsTypes";
import { agencyDisplayName, useAgencies } from "@/data/polls/useAgencies";
import { localizeFieldwork } from "@/data/polls/fieldwork";
import {
  upcomingPresidentialElection,
  upcomingPresidentialPolls,
} from "@/data/presidential/upcomingPolls";
import { daysUntil, formatLongDate } from "@/data/myarea/upcomingElections";
import { formatDecimal } from "@/lib/currency";
import { StatCard } from "@/screens/dashboard/StatCard";
import { PresidentialPersonName } from "@/screens/presidential/PresidentialPersonName";
import { Hint } from "@/ux/Hint";
import { Link } from "@/ux/Link";

export const PresidentialUpcomingPolls: FC<{
  polls: readonly Poll[];
  details: readonly PresidentialPollDetail[];
  /** Restricts the card to one agency's polls (the agency page). */
  agencyId?: string;
}> = ({ polls, details, agencyId }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data: agencies } = useAgencies();
  const election = upcomingPresidentialElection();
  const view = useMemo(
    () =>
      election
        ? upcomingPresidentialPolls(polls, details, election.date, {
            agencyId,
          })
        : null,
    [polls, details, election, agencyId],
  );
  if (!election || !view) return null;
  if (!view.rows.length && !view.otherPolls.length) return null;

  const days = daysUntil(election.date);
  const max = Math.max(
    0.01,
    ...view.rows.flatMap((r) =>
      view.candidates.map((c) => r.shares.get(c.key) ?? 0),
    ),
  );
  const hasUndecided = view.rows.some((r) => r.undecided !== null);

  return (
    <StatCard
      label={
        <Hint text={t("presidential_upcoming_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            <span>
              {t("presidential_upcoming_title", {
                date: formatLongDate(election.date, lang),
              })}
            </span>
          </div>
        </Hint>
      }
    >
      <p className="text-sm mt-1 text-muted-foreground">
        {t(
          election.confidence === "scheduled"
            ? "presidential_upcoming_days"
            : "presidential_upcoming_days_estimated",
          { count: days },
        )}{" "}
        {t("presidential_upcoming_note")}
      </p>
      {view.rows.length ? (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs">
            <caption className="sr-only">
              {t("presidential_upcoming_title", {
                date: formatLongDate(election.date, lang),
              })}
            </caption>
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="text-left font-medium py-1 pr-3">
                  {t("polls_agency")}
                </th>
                <th scope="col" className="text-left font-medium py-1 pr-3">
                  {t("presidential_upcoming_fieldwork")}
                </th>
                {view.candidates.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className="text-left font-medium py-1 pr-3 normal-case tracking-normal text-foreground"
                  >
                    <PresidentialPersonName name={c.name_bg} />
                  </th>
                ))}
                {hasUndecided ? (
                  <th scope="col" className="text-right font-medium py-1 pr-3">
                    {t("presidential_upcoming_undecided")}
                  </th>
                ) : null}
                <th scope="col" className="text-left font-medium py-1">
                  {t("presidential_upcoming_base")}
                </th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.poll.id} className="border-t align-middle">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <Link
                      to={`/polls/${r.poll.agencyId}/presidential`}
                      className="font-medium hover:underline"
                      underline={false}
                    >
                      {agencyDisplayName(
                        agencies,
                        r.poll.agencyId,
                        lang === "bg",
                      )}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                    {r.poll.source ? (
                      <a
                        href={r.poll.source}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="hover:underline"
                      >
                        {localizeFieldwork(r.poll.fieldwork, lang === "bg")}
                      </a>
                    ) : (
                      localizeFieldwork(r.poll.fieldwork, lang === "bg")
                    )}
                  </td>
                  {view.candidates.map((c) => {
                    const v = r.shares.get(c.key);
                    return (
                      <td key={c.key} className="py-1.5 pr-3 min-w-[110px]">
                        {v === undefined ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="relative h-2 flex-1 rounded-full bg-muted overflow-hidden">
                              <div
                                className="absolute top-0 bottom-0 left-0 rounded-full bg-primary/70"
                                style={{
                                  width: `${Math.max(2, (v / max) * 100)}%`,
                                }}
                              />
                            </div>
                            <span className="tabular-nums font-semibold w-11 text-right">
                              {formatDecimal(v, i18n.language, 1)}%
                            </span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                  {hasUndecided ? (
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                      {r.undecided === null
                        ? "—"
                        : `${formatDecimal(r.undecided, i18n.language, 1)}%`}
                    </td>
                  ) : null}
                  <td className="py-1.5 text-muted-foreground">
                    {r.question.base.label[lang]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {view.otherPolls.length ? (
        <p className="text-xs mt-3 text-muted-foreground">
          {t("presidential_upcoming_other", {
            count: view.otherPolls.length,
            agencies: [
              ...new Set(
                view.otherPolls.map((p) =>
                  agencyDisplayName(agencies, p.agencyId, lang === "bg"),
                ),
              ),
            ].join(", "),
          })}
        </p>
      ) : null}
    </StatCard>
  );
};
