import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Vote } from "lucide-react";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { useMpLoyalty } from "@/data/parliament/votes/useMpLoyalty";
import { useMpSimilarity } from "@/data/parliament/votes/useMpSimilarity";
import { MpVotingTile } from "./MpVotingTile";
import { MpTwinsTile } from "./MpTwinsTile";

/** The roll-call portion of a candidate page (voting record + cross-party
 * twins). Split out of `MpProfileSections` so the whole section — header
 * included — disappears when the MP has no roll-call data in the selected
 * parliament, instead of leaving an empty "Voting & similarity" heading.
 *
 * The two child tiles each self-hide when empty; this wrapper additionally
 * hides the section *title* once both come back empty. `MpProfileSections`
 * only mounts this when the MP actually served in the selected NS, so for
 * former / off-ballot MPs the section never mounts and we skip the
 * parliament/votes data fetches entirely. */
export const MpVotingSection: FC<{
  name: string;
  linkSlug: string;
  mpId: number | null;
}> = ({ name, linkSlug, mpId }) => {
  const { t } = useTranslation();

  const { entry: loyalty, isLoading: loyaltyLoading } = useMpLoyalty(
    mpId,
    name,
  );
  const { entry: similarity, isLoading: simLoading } = useMpSimilarity(
    mpId,
    name,
  );

  const hasVoting = !!loyalty && loyalty.votesCast > 0;
  const hasTwins = !!similarity && (similarity.topK?.length ?? 0) > 0;
  const loading = loyaltyLoading || simLoading;

  // Once the data resolves and there's nothing to show, render nothing — no
  // empty section header. While loading we keep the section so the tiles'
  // skeletons can reserve space.
  if (!loading && !hasVoting && !hasTwins) return null;

  return (
    <DashboardSection
      id="parliament"
      title={t("mp_section_voting") || "Voting & similarity"}
      icon={Vote}
    >
      <MpVotingTile name={name} linkSlug={linkSlug} />
      <MpTwinsTile name={name} />
    </DashboardSection>
  );
};
