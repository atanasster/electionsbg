import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import { Title } from "@/ux/Title";
import { Link } from "@/ux/Link";
import { useMps } from "@/data/parliament/useMps";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { MpSimilarityBrowser } from "@/screens/components/votes/MpSimilarityBrowser";

// Standalone full-ranking view for a single MP's voting peers — accessed via
// the compact MpSimilarityBrowser embedded on the candidate page. Renders
// the same component with a larger perSide cap and no "see full" link.
export const MpSimilarityScreen: FC = () => {
  const { mpId: mpIdParam } = useParams<{ mpId: string }>();
  const { t } = useTranslation();
  const { findMpById } = useMps();

  const mpId = mpIdParam ? Number(mpIdParam) : null;
  const mp = mpId != null ? findMpById(mpId) : null;
  const name = mp?.name ?? "";

  const pageTitle = `${t("mp_similarity_title") || "Voting peers"}${name ? ` · ${name}` : ""}`;

  return (
    <div className="w-full px-4 md:px-8">
      <Title description={pageTitle}>{pageTitle}</Title>

      <div className="max-w-5xl mx-auto pb-12 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {mp ? (
            <Link
              to={`/candidate/mp-${mp.id}`}
              underline={false}
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ChevronLeft className="h-4 w-4" />
              <MpAvatar mpId={mp.id} name={mp.name} />
              {mp.name}
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">
              {t("loading") || "Loading…"}
            </span>
          )}
        </div>

        {mp ? (
          <MpSimilarityBrowser
            mpId={mp.id}
            name={mp.name}
            perSide={20}
            showFullLink={false}
          />
        ) : (
          <div className="text-sm text-muted-foreground">
            {t("mp_similarity_empty") ||
              "Not enough vote overlap to compute peers."}
          </div>
        )}
      </div>
    </div>
  );
};
