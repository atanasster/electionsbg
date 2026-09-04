// THE electoral body — one presentational component rendered by BOTH candidate surfaces:
// `/candidate/:id` (CandidateDashboardCards, fed by the name-folder shards) and
// `/person/:slug` (PersonElectoralSection, fed by person_election_stats). Everything that
// used to be decided twice is decided here once.
//
// It exists because the two surfaces had silently drifted apart after the
// person-candidate merge (docs/plans/person-candidate-display-unification-v1.md §1.2): the
// person page had a cycle heading and a highlighted trajectory and no summary line, the
// candidate page had a summary line and an un-highlighted trajectory and no heading — for
// the SAME human, reachable from either URL. A reader arriving by one route was shown
// something the other route withheld, with nothing in either page saying so.
//
// The two callers may differ in these ways, all of them props:
//   • which hook produced `summary` (shard reducer vs PG payload — the same reducer either
//     way, `computeCandidateSummary`);
//   • the section ids / titles / article topics they declare (a page's own IA);
//   • `linkSlug`, which only decides where the drill-downs point;
//   • whether a cycle SELECTOR is on the page (`selector`). One prop, not two, because it
//     carries one fact with three consequences — the „Избори <date>" heading, the dimming
//     of every bar the selector is not pointing at, and an `?elections=` on each drill-down
//     link. A page with no selector has no cycle of its own to name: its cards ARE the
//     header's cycle, the header already prints the ballot, and there is nothing for a dim
//     bar to contrast against. Splitting these into independent props is what let the §1.2
//     divergence exist, so they are deliberately unstateable apart;
//   • ⚠ `history` — the ONE remaining DATA divergence, and a scheduled removal. The person
//     page plots the whole career, the candidate page the shard's own array. The prop exists
//     only until Tier 2 derives the arc inside `person_elections()`; delete it then rather
//     than extending it.
// Anything else that differs between the two pages is a defect in this file, not a prop.

import { FC, ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Gauge, Map } from "lucide-react";
import { CandidateStatsYearly } from "@/data/dataTypes";
import { CandidateDashboardSummary } from "@/data/dashboard/candidateDashboardTypes";
import { DashboardSectionId } from "@/data/articles/useArticles";
import { dottedDate } from "@/data/utils";
import { PartyBadge } from "@/screens/components/PartyBadge";
import { CandidateSummaryLine } from "@/screens/components/candidates/CandidateSummaryLine";
import { CandidatePreferencesCard } from "./cards/CandidatePreferencesCard";
import { CandidatePaperMachineCard } from "./cards/CandidatePaperMachineCard";
import { CandidateBallotCard } from "./cards/CandidateBallotCard";
import { CandidateTopRegionCard } from "./cards/CandidateTopRegionCard";
import { CandidateRegionsTile } from "./CandidateRegionsTile";
import { CandidateTrajectoryTile } from "./CandidateTrajectoryTile";
import { CandidateTopSettlementsTile } from "./CandidateTopSettlementsTile";
import { CandidateTopSectionsTile } from "./CandidateTopSectionsTile";
import { DashboardSection, DashboardSectionIdProp } from "./DashboardSection";

/** A caller's own IA for one of the two sections this body renders. */
export type ElectoralSectionMeta<
  Id extends DashboardSectionIdProp = DashboardSectionIdProp,
> = {
  id: Id;
  title: ReactNode;
  /** Wires the „Свързани анализи" rail, and only inside a SectionArticlesProvider. Each
   *  article is assigned to ONE topic, so pointing a section at a different topic's
   *  articles starves that topic's own section — hence the constraint to this section's
   *  own id wherever the id is itself a topic. */
  articleTopic?: Id extends DashboardSectionId ? Id : DashboardSectionId;
  /** 2 on both surfaces: these sections ARE the structure under the page's `<h1>`, so a
   *  span title leaves the outline jumping straight to this block's own `<h3>`. See
   *  DashboardSection's own `headingLevel` doc for why the default is a span. */
  headingLevel?: 2 | 3;
};

/** The page's cycle selector and the cycle it currently points at — or nothing at all.
 *  These travel together by construction: see the file header for why they are one prop. */
export type CycleSelector = {
  /** The cycle these cards describe. */
  cycle: string;
  /** The control itself. Omitted when the person has only one cycle, which still leaves a
   *  cycle of their own to name — hence optional here rather than a second prop. */
  control?: ReactNode;
};

type Props = {
  summary: CandidateDashboardSummary;
  /** Full-arc history override. The person page's trajectory is the person's WHOLE career,
   *  which is wider than the selected cycle's own row; omit it to plot `summary.history`.
   *  Scheduled for removal — see the file header. */
  history?: CandidateStatsYearly[];
  /** Slug for the drill-down links. When omitted, each child tile falls back to
   *  `encodeURIComponent(summary.name)` — the links still resolve, keyed by name rather
   *  than by slug, which is what the legacy bare-name candidate URLs do. */
  linkSlug?: string;
  selector?: CycleSelector;
  electoralSection: ElectoralSectionMeta;
  geographySection: ElectoralSectionMeta;
};

/** The cycle heading: WHICH election these cards are for, on which ballot, at which list
 *  position(s). Rendered only beside a selector — on a surface whose cycle is the page
 *  header's, `CandidateHeader` already prints the badge and the `№pref` chips, and a third
 *  copy of both was the drift this refactor introduced and then removed. */
const CycleHeading: FC<{ summary: CandidateDashboardSummary }> = ({
  summary,
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <h3 className="text-lg font-bold text-foreground">
        {t("pp_election_heading", { date: dottedDate(summary.election) })}
      </h3>
      {summary.partyNickName && (
        <PartyBadge label={summary.partyNickName} color={summary.partyColor} />
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
  );
};

export const CandidateElectoralBody: FC<Props> = ({
  summary,
  history,
  linkSlug,
  selector,
  electoralSection,
  geographySection,
}) => {
  const hasGeography =
    summary.topSettlements.length > 0 || summary.topSections.length > 0;
  const cycle = selector?.cycle;

  // Prefer the override only when it can actually DRAW: the tile needs ≥2 entries, so a
  // 1-entry override would SUPPRESS a trajectory `summary.history` was going to render.
  // Memoised because the spread would otherwise hand a Recharts chart a fresh object on
  // every render — and throw away the `useMemo` the person page already paid for.
  const trajectory = useMemo(
    () =>
      (history?.length ?? 0) > 1 ? { ...summary, history: history! } : summary,
    [summary, history],
  );

  return (
    <>
      <DashboardSection
        id={electoralSection.id}
        title={electoralSection.title}
        icon={Gauge}
        articleTopic={electoralSection.articleTopic}
        headingLevel={electoralSection.headingLevel}
        subtitle={selector?.control}
      >
        {/* The plain-language recap. Most traffic here arrives from a name search, so the
            headline question — how many preference votes, which election, strongest where —
            is answered in a sentence before the tile grid. Self-hides at zero votes. */}
        <CandidateSummaryLine data={summary} />
        {selector ? <CycleHeading summary={summary} /> : null}
        {/* The paper/machine split card self-hides when the cycle has no split (all-machine
            or paper-only), so the grid width tracks the card COUNT — 3 cards fill 3 columns
            instead of leaving a ragged empty one. */}
        <div
          className={
            summary.paperMachine
              ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
              : "grid grid-cols-1 gap-3 sm:grid-cols-3"
          }
        >
          <CandidatePreferencesCard
            data={summary}
            linkSlug={linkSlug}
            election={cycle}
          />
          <CandidatePaperMachineCard
            paperMachine={summary.paperMachine}
            priorElection={summary.priorElection}
          />
          <CandidateBallotCard data={summary} election={cycle} />
          <CandidateTopRegionCard data={summary} election={cycle} />
        </div>
        <CandidateRegionsTile
          data={summary}
          linkSlug={linkSlug}
          election={cycle}
        />
        <CandidateTrajectoryTile data={trajectory} highlightDate={cycle} />
      </DashboardSection>

      {/* Gated on the ARRAYS, not on the tiles: DashboardSection cannot see through a
          component boundary, so two self-hiding tiles would otherwise leave an orphaned
          „География" heading above nothing. */}
      {hasGeography ? (
        <DashboardSection
          id={geographySection.id}
          title={geographySection.title}
          icon={Map}
          articleTopic={geographySection.articleTopic}
          headingLevel={geographySection.headingLevel}
        >
          <CandidateTopSettlementsTile
            data={summary}
            linkSlug={linkSlug}
            election={cycle}
          />
          <CandidateTopSectionsTile
            data={summary}
            linkSlug={linkSlug}
            election={cycle}
          />
        </DashboardSection>
      ) : null}
    </>
  );
};

const Pulse: FC<{ className: string }> = ({ className }) => (
  <div
    className={`animate-pulse rounded-xl border bg-card shadow-sm ${className}`}
  />
);

/** The body's OWN loading footprint, exported so the two callers cannot describe a layout
 *  this file has since changed.
 *
 *  It is not decoration. Both surfaces mount this block ABOVE everything else on the page,
 *  so a block that renders `null` until its query resolves injects ~1450px mid-page when it
 *  lands: `/candidate/<name>` is in both `CLS_ROUTES` and `SLOW_CLS_ROUTES`
 *  (tests/perf.spec.ts) for exactly that reason, and the person page's own regression was
 *  measured at CLS 0.32 — three times the budget. Every element the real body renders above
 *  the fold therefore needs a placeholder here, and the two must move together: the summary
 *  line and the section header were each unreserved on one of the two surfaces until this
 *  became one component. */
export const CandidateElectoralBodySkeleton: FC<{
  electoralSection: ElectoralSectionMeta;
  /** Omit to reserve no geography footprint — the candidate surface never did, and it does
   *  not hold back the sections below this block, so over-reserving there COLLAPSES onto
   *  already-painted content when a candidate turns out to have no geography rows. */
  geographySection?: ElectoralSectionMeta;
  /** Mirrors whether the caller passes a `selector` to the body: the cycle heading is only
   *  rendered beside one, so only that surface has its height to reserve. */
  withCycleHeading?: boolean;
}> = ({ electoralSection, geographySection, withCycleHeading }) => (
  <>
    <DashboardSection
      id={electoralSection.id}
      title={electoralSection.title}
      icon={Gauge}
      headingLevel={electoralSection.headingLevel}
    >
      {/* CandidateSummaryLine — one line of ~15px copy in a padded box. */}
      <Pulse className="h-[46px] border-transparent bg-muted/40 shadow-none" />
      {withCycleHeading ? (
        <div className="h-7 w-64 max-w-full animate-pulse rounded bg-muted" />
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Pulse className="h-[150px]" />
        <Pulse className="h-[150px]" />
        <Pulse className="h-[150px]" />
      </div>
      <Pulse className="h-[240px]" />
      <Pulse className="h-[200px]" />
    </DashboardSection>
    {geographySection ? (
      <DashboardSection
        id={geographySection.id}
        title={geographySection.title}
        icon={Map}
        headingLevel={geographySection.headingLevel}
      >
        <Pulse className="h-[340px]" />
        <Pulse className="h-[340px]" />
      </DashboardSection>
    ) : null}
  </>
);
