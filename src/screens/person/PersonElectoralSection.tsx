// The electoral block on the merged person dashboard (person-candidate-merge-v1): the same
// body the /candidate/:id page renders (`CandidateElectoralBody`), fed from
// person_election_stats (PG, re-keyed by person_id) instead of the name-folder shards. A
// cycle selector (the person's own candidacy chips) picks which election to detail; it
// defaults to the global ?elections= selector and rides its own ?pelect= param so switching
// it doesn't ripple to the whole app. Deep-links go to the existing /candidate/:slug/*
// drill-down sub-pages, carrying the selected cycle so they open on it.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useElectionContext } from "@/data/ElectionContext";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useRegions } from "@/data/regions/useRegions";
import {
  usePersonDataCycles,
  usePersonElectoralPending,
} from "@/data/dashboard/usePersonElections";
import { computeCandidateSummary } from "@/data/dashboard/computeCandidateSummary";
import { dottedDate } from "@/data/utils";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import {
  CandidateElectoralBody,
  CandidateElectoralBodySkeleton,
  type ElectoralSectionMeta,
} from "@/screens/dashboard/CandidateElectoralBody";
import { PersonSelfFunding } from "./PersonSelfFunding";
import { SectionArticlesProvider } from "@/screens/dashboard/SectionArticlesContext";
import { SECTION_TOPICS } from "@/screens/dashboard/sectionTopics";
import { Pill } from "@/components/ui/Pill";

type Candidacy = { election: string; slug: string };

// The „Свързани анализи" rail, which /candidate/:id has always had and the merged person
// dashboard did not — the last of the §1.2 differences. Each article lands in the FIRST topic
// it matches, so an article tagged both `votes` and `geography` appears once rather than in
// both sections; without the provider the strip falls back to filtering per section and lists
// it twice. The ORDER is shared with the candidate body (sectionTopics.ts), deliberately: an
// article's placement should not depend on which URL a reader arrived by.
//
// Measured 2026-09-04: no article is both election-scoped AND tagged one of these three, and
// none carries `geography` or `financing` at all — so the cycle override and the dedupe are
// correct-and-INERT today. They are wired now because the alternative is discovering both on
// the day an article lands.
//
// ⚠️ All three topics are declared HERE, including the financing one this file passes down to
// PersonSelfFunding. A topic declared in another component cannot say whether that component
// is inside this provider, and outside one the rail misbehaves silently.
//
// ⚠️ TWO of the three destinations are CONDITIONAL, the same hazard the candidate body
// records: `person-geography` is omitted when the person has no settlement/section rows, and
// `person-self-funding` when nothing is attributed — which is 487 of 29,715 people (1.6%).
// An article tagged ONLY `financing` therefore renders nowhere on 98.4% of person pages. Zero
// articles carry that topic or `geography` today; if one lands, tag it `votes` as well.
const ELECTORAL_SECTION: Omit<
  ElectoralSectionMeta<"person-electoral">,
  "title"
> = {
  id: "person-electoral",
  articleTopic: "votes",
  headingLevel: 2,
};
const GEOGRAPHY_SECTION: Omit<
  ElectoralSectionMeta<"person-geography">,
  "title"
> = {
  id: "person-geography",
  articleTopic: "geography",
  headingLevel: 2,
};

type Props = { slug: string; name: string; candidacies: Candidacy[] };

export const PersonElectoralSection: FC<Props> = ({
  slug,
  name,
  candidacies,
}) => {
  const { t } = useTranslation();
  const { selected: globalSelected, prevElections } = useElectionContext();
  const electoralSection = {
    ...ELECTORAL_SECTION,
    title: t("pp_candidacies"),
  };
  const geographySection = {
    ...GEOGRAPHY_SECTION,
    title: t("dashboard_section_geography"),
  };
  const { findRegion } = useRegions();
  // Only cycles the person ACTUALLY ran with results — a candidacy ROLE with no preference
  // data (e.g. a roster-only entry) shouldn't be a selectable year. Newest first.
  const { rows, dataCycles } = usePersonDataCycles(slug);
  // Shared with PersonDashboard, which holds back everything below this block for as long as
  // it is true — see usePersonElectoralPending.
  const pending = usePersonElectoralPending(slug, candidacies.length > 0);

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
        // `row.history` IS the person's whole arc — derived per person in
        // `person_elections()` (085), so there is no longest-history pick and no superset
        // fallback here any more, and no namesake's cycles in it. Plan §2.
        stats: row.history,
        top_settlements: row.topSettlements,
        top_sections: row.topSections,
      },
      findParty,
      findRegion,
    });
  }, [row, name, selectedCycle, prevElections, findParty, findRegion]);

  // No election with actual results → no electoral section (a candidacy role alone isn't
  // enough to show a dashboard of empty cards). But while the async fetch is still in flight
  // AND the person has a real candidacy (so we expect results), reserve the block's footprint
  // instead of nothing — otherwise the data lands ~1450px ABOVE the sections below it and
  // shoves the whole page down (the candidate-page CLS regression). Only fall through to null
  // once we KNOW there are no results — and by then the dashboard has kept the sections below
  // unmounted, so the reserved space collapses under nothing.
  if (dataCycles.length === 0 || !summary) {
    if (pending)
      return (
        <CandidateElectoralBodySkeleton
          electoralSection={electoralSection}
          geographySection={geographySection}
          withCycleHeading
        />
      );
    return null;
  }

  const selector =
    dataCycles.length > 1 ? (
      <div className="flex flex-wrap gap-1.5">
        {dataCycles.map((el) => {
          const active = el === selectedCycle;
          return (
            <Pill
              key={el}
              tone="neutral"
              size="sm"
              selected={active}
              onClick={() => setPelect(el === globalSelected ? undefined : el)}
            >
              {dottedDate(el)}
            </Pill>
          );
        })}
      </div>
    ) : null;

  return (
    // Scoped to the BLOCK's cycle, not the header's: the sections beneath this provider
    // describe `selectedCycle`, so an election-scoped article must match that.
    <SectionArticlesProvider order={SECTION_TOPICS} election={selectedCycle}>
      <CandidateElectoralBody
        summary={summary}
        linkSlug={candidateSlug}
        selector={{ cycle: selectedCycle, control: selector ?? undefined }}
        electoralSection={electoralSection}
        geographySection={geographySection}
      />
      {/* Campaign self-funding — the block the merged dashboard was missing entirely while
          /candidate/:id had it, and the reason the two pages read as different pages. Fed
          from the SAME payload as the electoral block (person_elections' per-cycle ЕРИК
          figures), so it needs no second fetch and cannot be namesake-conflated the way the
          name-keyed shard was. Self-hides when nothing is attributed. */}
      <PersonSelfFunding
        rows={rows}
        selectedCycle={selectedCycle}
        name={name}
        linkSlug={candidateSlug}
        articleTopic="financing"
      />
    </SectionArticlesProvider>
  );
};
