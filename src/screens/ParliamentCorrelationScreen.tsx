// /parliament/correlation — how closely each pair of parliamentary groups votes together.
//
// SPLIT OUT OF /votes. That page is an ARCHIVE: 613 plenary days, one row each, and the
// reason anyone lands on it is to find a sitting. It had grown a correlation heatmap and a
// contested-votes feed above the table, so the list the page exists for started below the
// fold — and the analysis had no page of its own to be linked to, indexed as, or shared.
// Two different jobs, two pages: the archive lists, this one explains.
//
// The heatmap component is reused rather than reimplemented at a larger size. It already
// renders the full matrix and is the same component the homepage governance card mounts, so
// a second implementation would be a second definition of "how close are these two groups"
// with nothing checking that they agree.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { ParliamentVotingTile } from "@/screens/dashboard/ParliamentVotingTile";
import { ContestedVotesFeed } from "@/screens/components/votes/ContestedVotesFeed";

export const ParliamentCorrelationScreen: FC = () => {
  const { t } = useTranslation();
  // The SAME name the hub tile uses. `votes_landing_correlation_title` („Как гласуват
  // групите") was the heading /votes gave this block, and a page whose h1 and whose tile
  // header are two different names for one chart reads as two charts.
  const pageTitle = t("nsh_tile_correlation");

  return (
    <>
      <Title description={t("nsh_correlation_description")}>{pageTitle}</Title>
      <GovernanceBreadcrumb
        sectionKey="gov_hub_parliament_title"
        sectionTo="/parliament"
        className="mt-5"
      />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ParliamentVotingTile />
        {/* The contested feed comes with it. It is the same question asked of individual
            items rather than of the whole matrix — where the groups actually parted — and on
            the archive page it was competing with the table for the same space. */}
        <ContestedVotesFeed />
      </div>
    </>
  );
};
