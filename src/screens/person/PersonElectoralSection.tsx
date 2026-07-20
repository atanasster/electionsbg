// The electoral block on the merged person dashboard (person-candidate-merge-v1): the same
// candidate stat cards + regions/trajectory tiles, but fed from person_election_stats (PG,
// re-keyed by person_id) instead of the name-folder shards. A cycle selector (the person's
// own candidacy chips) picks which election to detail; it defaults to the global ?elections=
// selector and rides its own ?pelect= param so switching it doesn't ripple to the whole app.
// Deep-links go to the existing /candidate/:slug/* drill-down sub-pages.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Gauge, Map } from "lucide-react";
import { useElectionContext } from "@/data/ElectionContext";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useRegions } from "@/data/regions/useRegions";
import { usePersonDataCycles } from "@/data/dashboard/usePersonElections";
import { computeCandidateSummary } from "@/data/dashboard/computeCandidateSummary";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { PartyBadge } from "@/screens/components/PartyBadge";
import { CandidatePreferencesCard } from "@/screens/dashboard/cards/CandidatePreferencesCard";
import { CandidatePaperMachineCard } from "@/screens/dashboard/cards/CandidatePaperMachineCard";
import { CandidateBallotCard } from "@/screens/dashboard/cards/CandidateBallotCard";
import { CandidateTopRegionCard } from "@/screens/dashboard/cards/CandidateTopRegionCard";
import { CandidateRegionsTile } from "@/screens/dashboard/CandidateRegionsTile";
import { CandidateTrajectoryTile } from "@/screens/dashboard/CandidateTrajectoryTile";
import { CandidateTopSettlementsTile } from "@/screens/dashboard/CandidateTopSettlementsTile";
import { CandidateTopSectionsTile } from "@/screens/dashboard/CandidateTopSectionsTile";

type Candidacy = { election: string; slug: string };

// "2021_11_14" -> "14.11.2021"
const fmtElection = (d: string): string => {
  const m = /^(\d{4})_(\d{2})_(\d{2})$/.exec(d);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d;
};

type Props = { slug: string; name: string; candidacies: Candidacy[] };

export const PersonElectoralSection: FC<Props> = ({
  slug,
  name,
  candidacies,
}) => {
  const { t } = useTranslation();
  const { selected: globalSelected, prevElections } = useElectionContext();
  const { findRegion } = useRegions();
  // Only cycles the person ACTUALLY ran with results — a candidacy ROLE with no preference
  // data (e.g. a roster-only entry) shouldn't be a selectable year. Newest first.
  const { rows, dataCycles } = usePersonDataCycles(slug);

  // Selected cycle: ?pelect when it's a real (data-bearing) cycle, else the global election
  // when they ran it, else their LAST election with results.
  const [pelect, setPelect] = useSearchParam("pelect");
  const selectedCycle =
    pelect && dataCycles.includes(pelect)
      ? pelect
      : dataCycles.includes(globalSelected)
        ? globalSelected
        : dataCycles[0];

  // Party colours/names must resolve for the SELECTED cycle's ballot, not the global one.
  const { findParty } = usePartyInfo(selectedCycle);

  const row = rows.find((r) => r.election === selectedCycle);
  const candidateSlug = candidacies.find(
    (c) => c.election === selectedCycle,
  )?.slug;

  const summary = useMemo(() => {
    if (!row) return null;
    return computeCandidateSummary({
      name,
      selected: selectedCycle,
      priorElectionName: prevElections(selectedCycle)?.name,
      regionRows: row.regions,
      stats: {
        stats: row.history,
        top_settlements: row.topSettlements,
        top_sections: row.topSections,
      },
      findParty,
      findRegion,
    });
  }, [row, name, selectedCycle, prevElections, findParty, findRegion]);

  // The trajectory is the person's WHOLE arc, so it always shows the fullest history — the
  // longest snapshot across the person's rows — never clipped to the selected cycle (an older
  // cycle's row only carries history up to that election).
  const fullHistory = useMemo(() => {
    const longest = rows
      .map((r) => r.history)
      .filter((h) => (h?.length ?? 0) > 0)
      .sort((a, b) => b.length - a.length)[0];
    return longest ?? [];
  }, [rows]);

  // No election with actual results → no electoral section (a candidacy role alone isn't
  // enough to show a dashboard of empty cards).
  if (dataCycles.length === 0 || !summary) return null;

  const selector =
    dataCycles.length > 1 ? (
      <div className="flex flex-wrap gap-1.5">
        {dataCycles.map((el) => {
          const active = el === selectedCycle;
          return (
            <button
              key={el}
              type="button"
              onClick={() => setPelect(el === globalSelected ? undefined : el)}
              aria-pressed={active}
              className={
                active
                  ? "rounded-full border border-primary bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground"
                  : "rounded-full border border-border px-2.5 py-0.5 text-xs text-primary hover:bg-muted"
              }
            >
              {fmtElection(el)}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <>
      <DashboardSection
        id="person-electoral"
        title={t("pp_candidacies")}
        icon={Gauge}
        subtitle={selector}
      >
        {/* Which election these cards are for + which list(s) they ran on — a prominent
            heading with the cycle's party badge + list positions (folds in the old cikRows). */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-lg font-bold text-foreground">
            {t("pp_election_heading", { date: fmtElection(selectedCycle) })}
          </h3>
          {summary.partyNickName && (
            <PartyBadge
              label={summary.partyNickName}
              color={summary.partyColor}
            />
          )}
          {summary.regions.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {summary.regions
                .slice(0, 3)
                .map((r) => `#${r.pref} ${r.long_name ?? r.name ?? r.oblast}`)
                .join(" · ")}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CandidatePreferencesCard data={summary} />
          <CandidatePaperMachineCard
            paperMachine={summary.paperMachine}
            priorElection={summary.priorElection}
          />
          <CandidateBallotCard data={summary} />
          <CandidateTopRegionCard data={summary} />
        </div>
        <CandidateRegionsTile
          data={summary}
          linkSlug={candidateSlug}
          election={selectedCycle}
        />
        <CandidateTrajectoryTile
          data={
            fullHistory.length ? { ...summary, history: fullHistory } : summary
          }
        />
      </DashboardSection>

      {summary &&
      (summary.topSettlements.length > 0 || summary.topSections.length > 0) ? (
        <DashboardSection
          id="person-geography"
          title={t("dashboard_section_geography")}
          icon={Map}
        >
          <CandidateTopSettlementsTile
            data={summary}
            linkSlug={candidateSlug}
            election={selectedCycle}
          />
          <CandidateTopSectionsTile
            data={summary}
            linkSlug={candidateSlug}
            election={selectedCycle}
          />
        </DashboardSection>
      ) : null}
    </>
  );
};
