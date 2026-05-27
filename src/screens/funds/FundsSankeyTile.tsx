// /funds — Fund → Programme → top-20 beneficiary Sankey. The shape is
// precomputed by scripts/funds/build_taxonomy_derivatives.ts; the SVG just
// lays it out via d3-sankey. Mirrors the procurement Sankey UX (hover
// dimming, tooltip with EUR) so the visual language stays consistent.

import { FC, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  sankey,
  sankeyJustify,
  sankeyLinkHorizontal,
  SankeyExtraProperties,
} from "d3-sankey";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Workflow } from "lucide-react";
import { useFundsSankey } from "@/data/funds/useFundsTaxonomy";
import type { FundsSankeyNode } from "@/data/funds/useFundsTaxonomy";
import { formatEur } from "@/lib/currency";
import { useTooltip } from "@/ux/useTooltip";

type NodeDatum = SankeyExtraProperties & FundsSankeyNode;
type LinkDatum = SankeyExtraProperties & { value: number };

const NODE_WIDTH = 14;
const NODE_PADDING = 6;
const HEIGHT = 600;

const TYPE_COLOR: Record<FundsSankeyNode["kind"], string> = {
  fund: "#1d4ed8", // royal blue — structural-fund family
  programme: "#0891b2", // teal — operational programme
  beneficiary: "#d97706", // amber — beneficiary org
};

const truncate = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

export const FundsSankeyTile: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useFundsSankey();
  const { tooltip, onMouseEnter, onMouseMove, onMouseLeave } = useTooltip();
  const [focusId, setFocusId] = useState<string | null>(null);

  // Programme nodes have ids like "prog:2014BG16RFOP002" — drill into the
  // existing /funds/programme/{code} screen on click.
  const onNodeClick = (n: FundsSankeyNode): void => {
    if (n.kind !== "programme") return;
    const code = n.id.replace(/^prog:/, "");
    if (!code) return;
    navigate(`/funds/programme/${encodeURIComponent(code)}`);
  };
  // Width is resolved with a layout observer; SSR-safe initial.
  const [width, setWidth] = useState<number>(960);

  const graph = useMemo(() => {
    if (!data) return null;
    const idToIdx = new Map<string, number>();
    data.nodes.forEach((n, i) => idToIdx.set(n.id, i));
    const sankeyLinks: Array<{
      source: number;
      target: number;
      value: number;
    }> = [];
    for (const l of data.links) {
      const s = idToIdx.get(l.source);
      const tgt = idToIdx.get(l.target);
      if (s === undefined || tgt === undefined) continue;
      if (!(l.value > 0)) continue;
      sankeyLinks.push({ source: s, target: tgt, value: l.value });
    }
    return {
      nodes: data.nodes.map((n) => ({ ...n })),
      links: sankeyLinks,
    };
  }, [data]);

  const layout = useMemo(() => {
    if (!graph || width <= 0) return null;
    if (graph.nodes.length === 0 || graph.links.length === 0) return null;
    try {
      const gen = sankey<NodeDatum, LinkDatum>()
        .nodeWidth(NODE_WIDTH)
        .nodePadding(NODE_PADDING)
        .nodeAlign(sankeyJustify)
        .extent([
          [0, 8],
          [width, HEIGHT - 16],
        ]);
      return gen({
        nodes: graph.nodes,
        links: graph.links,
      });
    } catch {
      return null;
    }
  }, [graph, width]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {t("funds_sankey_title") ||
              "Money flow: fund → programme → beneficiary"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 md:p-4">
          <div className="h-[520px] animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Workflow className="h-4 w-4 text-muted-foreground" />
          {t("funds_sankey_title") ||
            "Money flow: fund → programme → beneficiary"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-1 md:p-2">
        <p className="mb-2 px-2 text-xs text-muted-foreground">
          {t("funds_sankey_intro") ||
            "Every structural fund (ERDF, ESF, Cohesion, EAFRD, JTF + the Recovery Plan), its operational programmes, and the top-20 beneficiaries per top-6 programmes. Ribbon width is proportional to contracted EUR."}
        </p>
        <div
          className="w-full overflow-x-auto"
          ref={(el) => {
            if (el && el.clientWidth > 0 && el.clientWidth !== width) {
              setWidth(el.clientWidth);
            }
          }}
        >
          {layout ? (
            <svg
              width={width}
              height={HEIGHT}
              role="img"
              aria-label={
                t("funds_sankey_title") ||
                "Money flow: fund → programme → beneficiary"
              }
            >
              <g>
                {layout.links.map((link, i) => {
                  const sId =
                    typeof link.source === "object" && link.source
                      ? (link.source as NodeDatum).id
                      : "";
                  const tId =
                    typeof link.target === "object" && link.target
                      ? (link.target as NodeDatum).id
                      : "";
                  const dim =
                    focusId !== null && focusId !== sId && focusId !== tId;
                  return (
                    <path
                      key={i}
                      d={sankeyLinkHorizontal()(link) || ""}
                      fill="none"
                      stroke={
                        typeof link.target === "object" && link.target
                          ? TYPE_COLOR[(link.target as NodeDatum).kind]
                          : "#94a3b8"
                      }
                      strokeOpacity={dim ? 0.05 : 0.25}
                      strokeWidth={Math.max(1, link.width ?? 1)}
                      onMouseEnter={(e) => {
                        onMouseEnter(
                          e,
                          <span className="tabular-nums">
                            {formatEur(link.value)}
                          </span>,
                        );
                      }}
                      onMouseMove={onMouseMove}
                      onMouseLeave={onMouseLeave}
                    />
                  );
                })}
              </g>
              <g>
                {layout.nodes.map((n) => {
                  const w = NODE_WIDTH;
                  const h = Math.max(2, (n.y1 ?? 0) - (n.y0 ?? 0));
                  const dim = focusId !== null && focusId !== n.id;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x0 ?? 0}, ${n.y0 ?? 0})`}
                      onMouseEnter={(e) => {
                        setFocusId(n.id);
                        onMouseEnter(
                          e,
                          <span className="flex flex-col gap-0.5">
                            <span className="font-medium">{n.label}</span>
                            <span className="text-xs tabular-nums">
                              {formatEur(n.totalEur)}
                            </span>
                          </span>,
                        );
                      }}
                      onMouseMove={onMouseMove}
                      onMouseLeave={() => {
                        setFocusId(null);
                        onMouseLeave();
                      }}
                      onClick={() => onNodeClick(n)}
                      style={{
                        cursor: n.kind === "programme" ? "pointer" : "default",
                      }}
                    >
                      <rect
                        width={w}
                        height={h}
                        fill={TYPE_COLOR[n.kind]}
                        fillOpacity={dim ? 0.25 : 0.85}
                      />
                      {/* Label fund + programme nodes. Right-column
                          programme nodes anchor end (label sits to the LEFT
                          of the rect so it doesn't overflow the SVG). */}
                      {h >= 7 ? (
                        <text
                          x={n.kind === "programme" ? -4 : w + 4}
                          textAnchor={n.kind === "programme" ? "end" : "start"}
                          y={h / 2}
                          dy="0.32em"
                          fontSize={n.kind === "fund" ? 12 : 10}
                          fontWeight={n.kind === "fund" ? 600 : 500}
                          fill="currentColor"
                          fillOpacity={dim ? 0.4 : 1}
                        >
                          {truncate(n.label, 44)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            </svg>
          ) : null}
        </div>
        {tooltip}
        <div className="mt-2 flex flex-wrap items-center gap-3 px-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: TYPE_COLOR.fund }}
            />
            {t("funds_sankey_legend_fund") || "Fund family"}
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: TYPE_COLOR.programme }}
            />
            {t("funds_sankey_legend_programme") || "Operational programme"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};
