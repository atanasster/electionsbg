import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Vote } from "lucide-react";
import { DashboardSection } from "./DashboardSection";
import { ParliamentVotingTile } from "./ParliamentVotingTile";
import { EmbeddingMiniTile } from "./EmbeddingMiniTile";
import { usePartyCorrelation } from "@/data/parliament/votes/usePartyCorrelation";
import { useMpEmbedding } from "@/data/parliament/votes/useMpEmbedding";

// The two tiles are election-scoped; we don't have roll-call ingest for
// parliaments before the 51st NS. Hide the whole section (heading + articles
// strip included) when neither has a slice for the currently-selected election
// so the home page doesn't show a parliament header with nothing under it.

export const ParliamentSection: FC = () => {
  const { t } = useTranslation();
  const { slice: correlation, isLoading: corrLoading } = usePartyCorrelation();
  const { slice: embedding, isLoading: embLoading } = useMpEmbedding();

  if (corrLoading || embLoading) return null;
  if (!correlation && !embedding) return null;

  return (
    <DashboardSection
      id="parliament"
      title={t("dashboard_section_parliament")}
      icon={Vote}
      articleTopic="parliament"
    >
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
        <ParliamentVotingTile />
        <EmbeddingMiniTile />
      </div>
    </DashboardSection>
  );
};
