import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Link } from "@/ux/Link";
import { useMpEmbedding } from "@/data/parliament/votes/useMpEmbedding";
import { useMpProfile } from "@/data/parliament/votes/useMpProfile";
import { useCandidateUrlForVote } from "@/data/parliament/votes/useCandidateUrlForVote";
import { useMps } from "@/data/parliament/useMps";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";

const PREVIEW = 5;
const K = 5;

// Same bridge-MP detection used inside ParliamentEmbeddingScreen, scoped down
// to the top 5 outliers for a homepage-style preview.
//
// Party affiliation comes from the latest session's mpParty map (authoritative
// per-NS party assignment); the deduped roster's currentPartyGroupShort is
// frequently null because parliament.bg recycles MP ids across parliaments.
export const ParliamentEmbeddingMiniTile: FC = () => {
  const { t } = useTranslation();
  const { points, isLoading: emLoading } = useMpEmbedding();
  const { mpParty, mpNames } = useMpProfile();
  const { findMpById, isLoading: mpsLoading } = useMps();
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();
  const candidateUrl = useCandidateUrlForVote();

  const bridges = useMemo(() => {
    if (points.length === 0) return [];
    type Enriched = {
      mpId: number;
      x: number;
      y: number;
      name: string;
      partyShort: string | null;
    };
    const enriched: Enriched[] = [];
    for (const p of points) {
      const id = p.mpId;
      enriched.push({
        mpId: id,
        x: p.x,
        y: p.y,
        name: findMpById(id)?.name ?? mpNames[String(id)] ?? `MP #${id}`,
        partyShort: mpParty[String(id)] ?? null,
      });
    }
    const results: Array<{
      mp: Enriched;
      foreignCount: number;
      neighborParties: string[];
    }> = [];
    for (const a of enriched) {
      if (!a.partyShort) continue;
      const dists = enriched
        .filter((b) => b.mpId !== a.mpId)
        .map((b) => ({ mp: b, d: Math.hypot(a.x - b.x, a.y - b.y) }))
        .sort((x, y) => x.d - y.d)
        .slice(0, K);
      const foreign = dists.filter(
        (n) => n.mp.partyShort && n.mp.partyShort !== a.partyShort,
      );
      if (foreign.length > K / 2) {
        results.push({
          mp: a,
          foreignCount: foreign.length,
          neighborParties: [
            ...new Set(
              foreign
                .map((f) => f.mp.partyShort)
                .filter((p): p is string => !!p),
            ),
          ],
        });
      }
    }
    return results
      .sort((x, y) => y.foreignCount - x.foreignCount)
      .slice(0, PREVIEW);
  }, [points, mpParty, mpNames, findMpById]);

  if (emLoading || mpsLoading) {
    return (
      <Card aria-hidden>
        <CardContent>
          <div className="min-h-[260px]" />
        </CardContent>
      </Card>
    );
  }
  if (bridges.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <MapIcon className="h-4 w-4" />
          {t("hub_embedding_title") || "Voting space"}
          <Link
            to="/parliament/embedding"
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
          {t("embedding_outliers_hint") ||
            "MPs whose nearest neighbours are mostly from a different parliamentary group — the most plausible candidates for cross-party voting."}
        </div>
        <ul className="divide-y">
          {bridges.map((b) => {
            const color = colorForPartyShort(b.mp.partyShort) ?? "#94a3b8";
            return (
              <li key={b.mp.mpId}>
                <Link
                  to={candidateUrl(b.mp.mpId, b.mp.name)}
                  underline={false}
                  className="flex items-center gap-2 py-1.5 text-xs hover:bg-muted/40 rounded px-1"
                >
                  <MpAvatar name={b.mp.name} />
                  <span className="flex-1 truncate">{b.mp.name}</span>
                  <span
                    className="text-[10px] uppercase tracking-wide shrink-0 truncate max-w-[110px]"
                    style={{ color }}
                  >
                    {labelForPartyShort(b.mp.partyShort) || b.mp.partyShort}
                  </span>
                  <span className="font-semibold tabular-nums shrink-0">
                    {b.foreignCount}/{K}
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
