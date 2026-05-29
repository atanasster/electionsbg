import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Link } from "@/ux/Link";
import { useSimilarityHeadline } from "@/data/parliament/votes/useSimilarityHeadline";
import { useMpProfile } from "@/data/parliament/votes/useMpProfile";
import { useCandidateUrlForVote } from "@/data/parliament/votes/useCandidateUrlForVote";
import { useMps } from "@/data/parliament/useMps";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { titleCaseName } from "@/lib/utils";

const formatScore = (score: number, lang: string): string =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(Math.max(-1, Math.min(1, score)));

// Hub-level highlight: reads the precomputed similarity_headline shard
// (~1 KB total across all NSes) instead of the 1.45 MB full similarity
// aggregate. The headline shard already encodes which MP has the most
// cross-party twins per NS, plus their top-3 twins.
export const ParliamentSimilarityMiniTile: FC = () => {
  const { t, i18n } = useTranslation();
  const { headline, isLoading: headlineLoading } = useSimilarityHeadline();
  const { mpNames } = useMpProfile();
  const { findMpById, isLoading: mpsLoading } = useMps();
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();
  const candidateUrl = useCandidateUrlForVote();

  const nameOf = (id: number): string =>
    titleCaseName(findMpById(id)?.name ?? mpNames[String(id)]) || `MP #${id}`;

  if (headlineLoading || mpsLoading) {
    return (
      <Card aria-hidden>
        <CardContent>
          <div className="min-h-[260px]" />
        </CardContent>
      </Card>
    );
  }
  if (!headline) return null;

  const lang = i18n.language;
  const seedName = nameOf(headline.seedId);
  const seedLabel =
    labelForPartyShort(headline.seedPartyShort) || headline.seedPartyShort;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Sparkles className="h-4 w-4" />
          {t("hub_similarity_title") || "Voting twins"}
          <Link
            to={candidateUrl(headline.seedId, seedName)}
            underline={false}
            className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
          >
            {t("dashboard_see_details") || "See details"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xs text-muted-foreground mb-2">
          {t("hub_similarity_lede") ||
            "Largest cross-party overlap: the MP whose voting record best matches MPs from other groups."}
        </div>
        <div className="text-sm mb-3 flex items-center gap-2">
          <MpAvatar name={seedName} mpId={headline.seedId} />
          <Link
            to={candidateUrl(headline.seedId, seedName)}
            underline={false}
            className="font-semibold hover:underline"
          >
            {seedName}
          </Link>
          <span className="text-xs text-muted-foreground">· {seedLabel}</span>
        </div>
        <ul className="space-y-1.5">
          {headline.twins.map((twin) => {
            const twinName = nameOf(twin.mpId);
            const color = colorForPartyShort(twin.partyShort) ?? "#94a3b8";
            const label =
              labelForPartyShort(twin.partyShort) || twin.partyShort;
            return (
              <li key={twin.mpId}>
                <Link
                  to={candidateUrl(twin.mpId, twinName)}
                  underline={false}
                  className="flex items-center gap-2 text-xs hover:bg-muted/40 rounded px-1 py-1"
                >
                  <MpAvatar name={twinName} mpId={twin.mpId} />
                  <span className="flex-1 truncate">{twinName}</span>
                  <span
                    className="text-[10px] uppercase tracking-wide shrink-0"
                    style={{ color }}
                  >
                    {label}
                  </span>
                  <span className="font-semibold tabular-nums shrink-0">
                    {formatScore(twin.score, lang)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
};
