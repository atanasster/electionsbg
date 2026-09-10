// The `/polls` hub's presidential-polls band — Tier 4 T4.4 Increment B
// (docs/plans/polls-agency-watchers-v1.md §11 item 3, "a section until the
// 2026 cycle has ≥5 polls, then its own route"). One card per AGENCY (its
// latest presidential poll), never per poll — the hub already lists every
// individual parliamentary poll on its own agency page, and this mirrors
// that split rather than duplicating the full poll list here.
//
// ⚠ AN INDEX, NOT A LEADERBOARD. The parliamentary section above sorts by
// accuracy (`AgencyProfile.shrunkMAEAdjusted`), which needs a SCORED poll —
// the presidential corpus has none yet, so this sorts by fieldwork recency
// instead. Once Tier 4b's historical backfill lands and named-candidate
// cycles get scored, this stays honest without a rewrite: it never claims a
// ranking it cannot support.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ListOrdered, Target } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { Agency, Poll } from "@/data/polls/pollsTypes";
import {
  usePresidentialPollDetails,
  usePresidentialPollsList,
} from "@/data/presidential/usePresidentialPolls";
import {
  fieldworkEndMs,
  localizeFieldwork,
  sortByFieldworkDesc,
} from "@/data/polls/fieldwork";
import { groupByPollSortedBySupport } from "@/data/polls/pollRows";
import { isNamedCandidateRow } from "@/data/polls/presidentialRow";
import { PresidentialPersonName } from "@/screens/presidential/PresidentialPersonName";
import { PollsSectionHeader } from "./PollsSectionHeader";

type Props = { agencies: Agency[] };

const TOP_CANDIDATES = 3;

const latestPerAgency = (polls: Poll[]): Poll[] => {
  const byAgency = new Map<string, Poll>();
  for (const p of polls) {
    const cur = byAgency.get(p.agencyId);
    if (
      !cur ||
      (fieldworkEndMs(p.fieldwork) ?? -Infinity) >
        (fieldworkEndMs(cur.fieldwork) ?? -Infinity)
    )
      byAgency.set(p.agencyId, p);
  }
  return sortByFieldworkDesc([...byAgency.values()]);
};

export const PresidentialPollsSection: FC<Props> = ({ agencies }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data: polls } = usePresidentialPollsList();
  const { data: details } = usePresidentialPollDetails();

  const latest = useMemo(() => latestPerAgency(polls ?? []), [polls]);
  const detailsByPoll = useMemo(
    () => groupByPollSortedBySupport(details ?? []),
    [details],
  );

  if (latest.length === 0) return null;

  const agencyById = new Map(agencies.map((a) => [a.id, a]));

  return (
    <>
      {/* The header is part of THIS component, not the hub's markup, so the whole section —
          header included — self-hides together with the `latest.length === 0` return above.
          A hub-owned header mounted unconditionally would orphan itself above nothing the
          first time the corpus is empty, the same anti-pattern `DashboardSection.tsx`'s own
          doc comment warns about. */}
      <PollsSectionHeader
        icon={<Target className="h-3.5 w-3.5" />}
        label={t("polls_section_presidential")}
        hint={t("polls_section_presidential_hint")}
      />
      <StatCard
        label={
          <div className="flex items-center gap-2">
            <ListOrdered className="h-4 w-4" />
            <span>{t("polls_presidential_by_agency")}</span>
          </div>
        }
      >
        <div className="flex flex-col gap-3 mt-1">
          {latest.map((p) => {
            const agency = agencyById.get(p.agencyId);
            const name = agency
              ? isBg
                ? agency.name_bg
                : agency.name_en
              : p.agencyId;
            const topRows = (detailsByPoll.get(p.id) ?? []).slice(
              0,
              TOP_CANDIDATES,
            );
            return (
              <div
                key={p.id}
                className="rounded-lg border bg-background/50 p-3 flex flex-col gap-1.5"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                  <Link
                    to={`/polls/${p.agencyId}`}
                    className="font-semibold text-sm text-primary hover:underline"
                  >
                    {name}
                  </Link>
                  <span className="text-muted-foreground">
                    {localizeFieldwork(p.fieldwork, isBg)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {topRows.map((d) => (
                    <span
                      key={d.candidateKey}
                      className="flex items-center gap-1"
                    >
                      {isNamedCandidateRow(d) ? (
                        <PresidentialPersonName name={d.candidateName_bg} />
                      ) : (
                        <span className="font-medium">
                          {d.candidateName_bg}
                        </span>
                      )}
                      <span className="tabular-nums font-semibold">
                        {d.support.toFixed(1)}%
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </StatCard>
    </>
  );
};
