import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { useMpSimilarity } from "@/data/parliament/votes/useMpSimilarity";
import { useMpProfile } from "@/data/parliament/votes/useMpProfile";
import { useCandidateUrlForVote } from "@/data/parliament/votes/useCandidateUrlForVote";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { ArrowRight } from "lucide-react";
import type { SimilarityPeer } from "@/data/parliament/votes/types";

type Props = {
  mpId?: number | null;
  name: string;
  /** Cap rows per side. Default 5 for the compact in-tile view; bumped to 20
   * on the standalone /parliament/similarity/:mpId screen. */
  perSide?: number;
  /** When true, renders a "See full ranking" link to the standalone screen. */
  showFullLink?: boolean;
};

// Stacked panels: closest peers (highest cosine, top) and most-different
// peers (lowest cosine, bottom). Label as "most different" not "most opposed"
// — for MPs in mostly-unanimous parliaments the bottom-K scores aren't
// always negative, just low.
export const MpSimilarityBrowser: FC<Props> = ({
  mpId,
  name,
  perSide = 5,
  showFullLink = true,
}) => {
  const { t } = useTranslation();
  const { entry, isLoading } = useMpSimilarity(mpId, name);
  const { mpNames } = useMpProfile();
  const candidateUrl = useCandidateUrlForVote();

  if (isLoading) return null;
  if (!entry) return null;

  const closest = entry.topK.slice(0, perSide);
  const opposed = (entry.bottomK ?? []).slice(0, perSide);

  if (closest.length === 0 && opposed.length === 0) {
    return (
      <div className="mt-5 pt-4 border-t">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          {t("mp_similarity_title") || "Voting peers"}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("mp_similarity_empty") ||
            "Not enough vote overlap to compute peers."}
        </p>
      </div>
    );
  }

  // Find the MP's roster id so the "see full ranking" link uses a stable URL.
  const rosterMpId = mpId ?? entry.mpId;

  return (
    <div className="mt-5 pt-4 border-t">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
        {t("mp_similarity_title") || "Voting peers"}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <PeerColumn
          heading={t("mp_similarity_closest") || "Closest peers"}
          peers={closest}
          mpNames={mpNames}
          candidateUrl={candidateUrl}
        />
        <PeerColumn
          heading={t("mp_similarity_opposed") || "Most different"}
          peers={opposed}
          mpNames={mpNames}
          candidateUrl={candidateUrl}
        />
      </div>
      {showFullLink && (
        <div className="mt-3 pt-3 border-t">
          <Link
            to={`/parliament/similarity/${rosterMpId}`}
            underline={false}
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            {t("mp_similarity_see_full") || "See full ranking"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
};

const PeerColumn: FC<{
  heading: string;
  peers: SimilarityPeer[];
  mpNames: Record<string, string>;
  candidateUrl: (csvMpId: number, sessionName?: string | null) => string;
}> = ({ heading, peers, mpNames, candidateUrl }) => {
  const { t } = useTranslation();
  if (peers.length === 0) {
    return (
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          {heading}
        </h4>
        <p className="text-xs text-muted-foreground">
          {t("mp_similarity_empty") || "Not enough overlap"}
        </p>
      </div>
    );
  }
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {heading}
      </h4>
      <ul className="divide-y">
        {peers.map((p) => {
          const name = mpNames[String(p.mpId)] ?? `MP #${p.mpId}`;
          return (
            <li key={p.mpId} className="py-2">
              <Link
                to={candidateUrl(p.mpId, name)}
                underline={false}
                className="flex items-center gap-2.5 text-sm hover:text-primary"
              >
                <MpAvatar mpId={p.mpId} name={name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{name}</div>
                </div>
                <div className="text-right tabular-nums shrink-0">
                  <div className="text-sm font-semibold">
                    {p.score.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {p.overlap}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
