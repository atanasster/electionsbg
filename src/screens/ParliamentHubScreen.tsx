import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { ParliamentSessionsTile } from "./dashboard/ParliamentSessionsTile";
import { ParliamentCohesionMiniTile } from "./dashboard/ParliamentCohesionMiniTile";
import { ParliamentSimilarityMiniTile } from "./dashboard/ParliamentSimilarityMiniTile";
import { ParliamentEmbeddingMiniTile } from "./dashboard/ParliamentEmbeddingMiniTile";
import { ParliamentVotingTile } from "./dashboard/ParliamentVotingTile";
import { ParliamentMostPresentMiniTile } from "./dashboard/ParliamentMostPresentMiniTile";
import { ParliamentMostAbsentMiniTile } from "./dashboard/ParliamentMostAbsentMiniTile";

export const ParliamentHubScreen: FC = () => {
  const { t } = useTranslation();
  const pageTitle = t("hub_title") || "Parliament — voting analytics";

  return (
    <>
      <Title description={t("hub_description") || pageTitle}>{pageTitle}</Title>

      <section aria-label={pageTitle} className="my-4">
        <p className="text-sm text-muted-foreground mb-6">
          {t("hub_intro") ||
            "Roll-call voting data from the Bulgarian National Assembly. Each tile previews one analysis — click into a tile for the full breakdown."}
        </p>

        <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
          <ParliamentSessionsTile />
          <ParliamentCohesionMiniTile />
          <ParliamentMostPresentMiniTile />
          <ParliamentMostAbsentMiniTile />
          <ParliamentVotingTile />
          <ParliamentSimilarityMiniTile />
          <ParliamentEmbeddingMiniTile />
        </div>

        <p className="text-xs text-muted-foreground mt-6">
          {t("hub_data_note") ||
            "Source: parliament.bg stenograms. Per-MP, per-item votes are extracted from the official roll-call CSV attached to each plenary day."}
        </p>
      </section>
    </>
  );
};
