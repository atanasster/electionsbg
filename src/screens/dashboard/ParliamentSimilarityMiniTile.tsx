import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Link } from "@/ux/Link";
import { useMpSimilarity } from "@/data/parliament/votes/useMpSimilarity";
import { useMpProfile } from "@/data/parliament/votes/useMpProfile";
import { useCandidateUrlForVote } from "@/data/parliament/votes/useCandidateUrlForVote";
import { useMps } from "@/data/parliament/useMps";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";

const PREVIEW_TWINS = 3;

const formatScore = (score: number, lang: string): string =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(Math.max(-1, Math.min(1, score)));

// Hub-level highlight: picks the seated MP with the most cross-party twins
// and previews them. The full per-MP twins list lives on each candidate's
// dashboard (MpTwinsTile), so the title link points into the seed MP's
// candidate page rather than to a dedicated /parliament/similarity screen.
export const ParliamentSimilarityMiniTile: FC = () => {
  const { t, i18n } = useTranslation();
  const { entries, isLoading: simLoading } = useMpSimilarity();
  const { mpParty, mpNames } = useMpProfile();
  const { findMpById, isLoading: mpsLoading } = useMps();
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();
  const candidateUrl = useCandidateUrlForVote();

  const nameOf = (id: number): string =>
    findMpById(id)?.name ?? mpNames[String(id)] ?? `MP #${id}`;
  const partyOf = (id: number): string | null => mpParty[String(id)] ?? null;

  const headline = useMemo(() => {
    if (entries.length === 0) return null;
    let best: {
      seedId: number;
      seedName: string;
      seedParty: string | null;
      crossPartyCount: number;
      twins: Array<{
        mpId: number;
        name: string;
        partyShort: string | null;
        score: number;
      }>;
    } | null = null;
    for (const e of entries) {
      const seedParty = partyOf(e.mpId);
      if (!seedParty) continue;
      const cross = [];
      for (const p of e.topK) {
        const peerParty = partyOf(p.mpId);
        if (!peerParty || peerParty === seedParty) continue;
        cross.push({
          mpId: p.mpId,
          name: nameOf(p.mpId),
          partyShort: peerParty,
          score: p.score,
        });
      }
      if (cross.length === 0) continue;
      if (!best || cross.length > best.crossPartyCount) {
        best = {
          seedId: e.mpId,
          seedName: nameOf(e.mpId),
          seedParty,
          crossPartyCount: cross.length,
          twins: cross
            .sort((a, b) => b.score - a.score)
            .slice(0, PREVIEW_TWINS),
        };
      }
    }
    return best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, mpParty, mpNames]);

  if (simLoading || mpsLoading) {
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
  const seedLabel =
    labelForPartyShort(headline.seedParty) || headline.seedParty;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Sparkles className="h-4 w-4" />
          {t("hub_similarity_title") || "Voting twins"}
          <Link
            to={candidateUrl(headline.seedId, headline.seedName)}
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
          <MpAvatar name={headline.seedName} />
          <Link
            to={candidateUrl(headline.seedId, headline.seedName)}
            underline={false}
            className="font-semibold hover:underline"
          >
            {headline.seedName}
          </Link>
          <span className="text-xs text-muted-foreground">· {seedLabel}</span>
        </div>
        <ul className="space-y-1.5">
          {headline.twins.map((twin) => {
            const color = colorForPartyShort(twin.partyShort) ?? "#94a3b8";
            const label =
              labelForPartyShort(twin.partyShort) || twin.partyShort;
            return (
              <li key={twin.mpId}>
                <Link
                  to={candidateUrl(twin.mpId, twin.name)}
                  underline={false}
                  className="flex items-center gap-2 text-xs hover:bg-muted/40 rounded px-1 py-1"
                >
                  <MpAvatar name={twin.name} />
                  <span className="flex-1 truncate">{twin.name}</span>
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
