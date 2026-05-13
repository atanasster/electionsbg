import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Scan, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Link } from "@/ux/Link";
import { useMpEmbedding } from "@/data/parliament/votes/useMpEmbedding";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import { useMpProfile } from "@/data/parliament/votes/useMpProfile";
import { useMps } from "@/data/parliament/useMps";
import { useTooltip } from "@/ux/useTooltip";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";

// Compact preview of the parliament-embedding scatter. Hover any dot for a
// candidate-card style tooltip (avatar + name + party + vote-similarity hint);
// click "Виж детайли" for the full screen with zoom/pan and the bridge MPs list.

const W = 280;
const H = 180;
const PAD = 6;
const FALLBACK_COLOR = "#94a3b8";

export const EmbeddingMiniTile: FC = () => {
  const { t } = useTranslation();
  const { points, isLoading } = useMpEmbedding();
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();
  const { findMpById } = useMps();
  const { tooltip, onMouseEnter, onMouseLeave } = useTooltip();

  // Per-NS party-fallback comes from mpProfileByNs in the rollcall index —
  // tiny (already loaded) compared to fetching a whole session JSON just for
  // these two maps. Parliament.bg recycles MP ids across NSes, so the roster
  // alone can't resolve party + name reliably.
  const { mpParty: sessionParty, mpNames: sessionNames } = useMpProfile();

  const projected = useMemo(() => {
    if (points.length === 0) return null;
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of points) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    const xSpan = Math.max(1e-6, xMax - xMin);
    const ySpan = Math.max(1e-6, yMax - yMin);
    const innerW = W - 2 * PAD;
    const innerH = H - 2 * PAD;
    const dots = points.map((p) => {
      const mp = findMpById(p.mpId);
      const party =
        mp?.currentPartyGroupShort ?? sessionParty[String(p.mpId)] ?? null;
      const color = colorForPartyShort(party) ?? FALLBACK_COLOR;
      const name = mp?.name ?? sessionNames[String(p.mpId)] ?? `MP #${p.mpId}`;
      return {
        mpId: p.mpId,
        x: PAD + ((p.x - xMin) / xSpan) * innerW,
        // svg y goes down — invert to keep "up" as positive y in data space.
        y: PAD + ((yMax - p.y) / ySpan) * innerH,
        color,
        name,
        party,
      };
    });
    return { dots };
  }, [points, sessionParty, sessionNames, colorForPartyShort, findMpById]);

  if (isLoading) {
    return (
      <Card aria-hidden>
        <CardContent>
          <div className="min-h-[260px]" />
        </CardContent>
      </Card>
    );
  }
  if (!projected || projected.dots.length === 0) return null;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Scan className="h-4 w-4" />
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
      <CardContent className="flex-1 flex flex-col">
        <p className="text-sm text-muted-foreground mb-3">
          {t("hub_embedding_desc")}
        </p>
        <div className="flex-1 flex items-center justify-center">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={t("hub_embedding_title") || "Voting space"}
            className="w-full h-auto"
          >
            {projected.dots.map((d) => {
              const partyLabel = d.party
                ? labelForPartyShort(d.party) || d.party
                : null;
              const tipContent = (
                <div className="flex items-center gap-2.5 text-xs">
                  <MpAvatar mpId={d.mpId} name={d.name} className="h-9 w-9" />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-medium truncate max-w-[220px]">
                      {d.name}
                    </span>
                    {partyLabel && (
                      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span
                          className="inline-block w-2 h-2 rounded-sm shrink-0"
                          style={{ backgroundColor: d.color }}
                        />
                        {partyLabel}
                      </span>
                    )}
                  </div>
                </div>
              );
              return (
                <circle
                  key={d.mpId}
                  cx={d.x}
                  cy={d.y}
                  r={2.6}
                  fill={d.color}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(e) =>
                    onMouseEnter({ pageX: e.pageX, pageY: e.pageY }, tipContent)
                  }
                  onMouseLeave={onMouseLeave}
                />
              );
            })}
          </svg>
          {tooltip}
        </div>
      </CardContent>
    </Card>
  );
};
