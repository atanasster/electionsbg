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
import { usePersonElections } from "@/data/dashboard/usePersonElections";
import { computeCandidateSummary } from "@/data/dashboard/computeCandidateSummary";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { CandidateSummaryLine } from "@/screens/components/candidates/CandidateSummaryLine";
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
  const { data: rows } = usePersonElections(slug);

  // The person's candidacy cycles, newest first, each with its /candidate slug.
  const cycles = useMemo(
    () => [...candidacies].sort((a, b) => b.election.localeCompare(a.election)),
    [candidacies],
  );
  const cycleDates = useMemo(() => cycles.map((c) => c.election), [cycles]);

  // Selected cycle: ?pelect if it's one the person contested, else the global election when
  // they ran that cycle, else their newest candidacy.
  const [pelect, setPelect] = useSearchParam("pelect");
  const selectedCycle =
    pelect && cycleDates.includes(pelect)
      ? pelect
      : cycleDates.includes(globalSelected)
        ? globalSelected
        : cycleDates[0];

  // Party colours/names must resolve for the SELECTED cycle's ballot, not the global one.
  const { findParty } = usePartyInfo(selectedCycle);

  const row = rows?.find((r) => r.election === selectedCycle);
  const candidateSlug = cycles.find((c) => c.election === selectedCycle)?.slug;

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

  if (cycles.length === 0) return null;

  const selector =
    cycles.length > 1 ? (
      <div className="flex flex-wrap gap-1.5">
        {cycles.map((c) => {
          const active = c.election === selectedCycle;
          return (
            <button
              key={c.election}
              type="button"
              onClick={() =>
                setPelect(
                  c.election === globalSelected ? undefined : c.election,
                )
              }
              aria-pressed={active}
              className={
                active
                  ? "rounded-full border border-primary bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground"
                  : "rounded-full border border-border px-2.5 py-0.5 text-xs text-primary hover:bg-muted"
              }
            >
              {fmtElection(c.election)}
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
        {summary ? (
          <>
            <CandidateSummaryLine data={summary} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <CandidatePreferencesCard data={summary} />
              <CandidatePaperMachineCard
                paperMachine={summary.paperMachine}
                priorElection={summary.priorElection}
              />
              <CandidateBallotCard data={summary} />
              <CandidateTopRegionCard data={summary} />
            </div>
            <CandidateRegionsTile data={summary} linkSlug={candidateSlug} />
            <CandidateTrajectoryTile data={summary} />
          </>
        ) : (
          // Keep the section (and its cycle selector) visible even when the picked cycle has
          // no stats row, so the chips don't vanish while the KPI still shows a candidacy count.
          <p className="text-sm text-muted-foreground">
            {t("pp_no_election_data")}
          </p>
        )}
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
          />
          <CandidateTopSectionsTile data={summary} linkSlug={candidateSlug} />
        </DashboardSection>
      ) : null}
    </>
  );
};
