// The electoral block on the LEGACY /candidate/:id body — the render that serves a candidate
// URL which could not be resolved to a person (an ambiguous bare name, a private or unknown
// person). Fed by the name-folder shards (useCandidateSummary).
//
// The block itself is `CandidateElectoralBody`, shared verbatim with the merged person
// dashboard, so the two surfaces cannot drift again. What stays here is only what is this
// page's own: the shard hook, the section IA (votes / geography / financing, which carry the
// article topics), and the campaign-financing tile.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Coins } from "lucide-react";
import { useElectionContext } from "@/data/ElectionContext";
import { useCandidateSummary } from "@/data/dashboard/useCandidateSummary";
import {
  CandidateElectoralBody,
  CandidateElectoralBodySkeleton,
  type ElectoralSectionMeta,
} from "./CandidateElectoralBody";
import { CandidateDonationsTile } from "./CandidateDonationsTile";
import { DashboardSection } from "./DashboardSection";
import { SectionArticlesProvider } from "./SectionArticlesContext";
import { SECTION_TOPICS } from "./sectionTopics";

// Each article lands in the FIRST topic it matches. ⚠ `geography` is a section the body OMITS
// when the candidate has no settlement/section rows, and `financing` one it omits on a cycle
// with no campaign financing, so a geography- or financing-ONLY article renders nowhere on
// those pages. Zero articles carry either topic today; if one lands, tag it `votes` as well.
// The ORDER is shared with the person dashboard — see sectionTopics.ts.

// Declared once so the skeleton and the resolved render cannot anchor to different section
// ids — a `#votes` deep link that exists only in one of the two states fails silently.
const ELECTORAL_SECTION: Omit<ElectoralSectionMeta<"votes">, "title"> = {
  id: "votes",
  articleTopic: "votes",
  headingLevel: 2,
};
const GEOGRAPHY_SECTION: Omit<ElectoralSectionMeta<"geography">, "title"> = {
  id: "geography",
  articleTopic: "geography",
  headingLevel: 2,
};

type Props = {
  name: string;
  /** Slug used for in-page navigation links (regions / sections / donations).
   * Defaults to URL-encoded name when omitted (legacy callers). When present,
   * keeps disambiguation context alive across click-throughs. */
  linkSlug?: string;
};

export const CandidateDashboardCards: FC<Props> = ({ name, linkSlug }) => {
  const { t } = useTranslation();
  const { electionStats } = useElectionContext();
  const { data, isLoading } = useCandidateSummary(name);
  const hasFinancials = !!electionStats?.hasFinancials;
  const navSlug = linkSlug ?? encodeURIComponent(name);
  const electoralSection = {
    ...ELECTORAL_SECTION,
    title: t("dashboard_section_votes"),
  };
  const geographySection = {
    ...GEOGRAPHY_SECTION,
    title: t("dashboard_section_geography"),
  };

  if (isLoading || data === undefined) {
    return (
      <section aria-label={t("dashboard")} className="my-4">
        {/* No `geographySection`: this surface does not hold back the sections beneath the
            block, so reserving a geography footprint a shard-less candidate never fills
            would collapse onto content that has already painted. */}
        <CandidateElectoralBodySkeleton electoralSection={electoralSection} />
      </section>
    );
  }

  if (data === null) {
    return null;
  }

  return (
    <SectionArticlesProvider order={SECTION_TOPICS}>
      <section aria-label={t("dashboard")} className="my-4">
        {/* No `selector`: this surface has no cycle of its own — its cards ARE the header's
            `?elections=` cycle, `CandidateHeader` already prints the ballot badge and the
            `№pref` chips, and there is nothing for a dimmed trajectory bar to contrast
            against. So no cycle heading, no highlight, and the drill-downs follow the
            global selector exactly as they always did.

            Two things DID change here when this surface adopted the shared body, both
            deliberate: the preferences card now honours `linkSlug` (it fell back to the
            URL-encoded name while every sibling tile used the slug), and the card grid
            drops to 3 columns on cycles with no paper/machine split rather than leaving a
            ragged empty fourth column. */}
        <CandidateElectoralBody
          summary={data}
          linkSlug={navSlug}
          electoralSection={electoralSection}
          geographySection={geographySection}
        />

        {hasFinancials ? (
          <DashboardSection
            id="financing"
            title={t("dashboard_section_financing")}
            icon={Coins}
            articleTopic="financing"
            headingLevel={2}
          >
            <CandidateDonationsTile name={name} linkSlug={navSlug} />
          </DashboardSection>
        ) : null}
      </section>
    </SectionArticlesProvider>
  );
};
