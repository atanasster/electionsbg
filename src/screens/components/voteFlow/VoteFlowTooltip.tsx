import { FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { VoteFlowMatrix, VoteFlowNode } from "@/data/voteFlows/voteFlowTypes";
import { formatThousands } from "@/data/utils";
import { tooltipSurfaceClass } from "@/components/ui/tooltipSurface";
import { cn } from "@/lib/utils";

// Cursor-following hover card. Two flavours:
//   • node hover  → "Party: total" + a 3-row preview of biggest in/out flows
//   • link hover  → "Source → Target: votes (% of source)"
//
// The tooltip lives in a fixed-position layer (so scrolling doesn't drift
// it off the cursor) and clamps itself to the viewport.

export type VoteFlowHover =
  | {
      kind: "node";
      id: string;
      side: "from" | "to";
      clientX: number;
      clientY: number;
    }
  | {
      kind: "link";
      from: string;
      to: string;
      votes: number;
      sourceVotes: number;
      clientX: number;
      clientY: number;
    };

type Props = {
  matrix: VoteFlowMatrix;
  hover: VoteFlowHover | null;
};

const TOOLTIP_W = 240;
const TOOLTIP_OFFSET = 14;
const PREVIEW_ROWS = 3;

const labelOf = (n: VoteFlowNode | undefined, isEn: boolean) =>
  n ? (isEn ? n.labelEn : n.label) : "—";

const sortAndSlice = (
  flows: VoteFlowMatrix["flows"],
  matchKey: "from" | "to",
  matchId: string,
  limit: number,
) =>
  flows
    .filter((f) => f[matchKey] === matchId)
    .sort((a, b) => b.votes - a.votes)
    .slice(0, limit);

export const VoteFlowTooltip: FC<Props> = ({ matrix, hover }) => {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === "en";
  const [vw, setVw] = useState<number>(
    typeof window !== "undefined" ? window.innerWidth : 1024,
  );
  const [vh, setVh] = useState<number>(
    typeof window !== "undefined" ? window.innerHeight : 768,
  );
  useEffect(() => {
    const onResize = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!hover) return null;

  // Position: prefer right-and-below the cursor; flip if it would clip the
  // viewport. Vertical clamp ignores the exact tooltip height (we can't
  // measure pre-render); 220px is a safe upper bound.
  let left = hover.clientX + TOOLTIP_OFFSET;
  if (left + TOOLTIP_W > vw - 8)
    left = hover.clientX - TOOLTIP_W - TOOLTIP_OFFSET;
  let top = hover.clientY + TOOLTIP_OFFSET;
  if (top + 220 > vh - 8)
    top = Math.max(8, hover.clientY - 220 - TOOLTIP_OFFSET);

  let body: React.ReactNode = null;

  if (hover.kind === "link") {
    const fromNode = matrix.fromNodes.find((n) => n.id === hover.from);
    const toNode = matrix.toNodes.find((n) => n.id === hover.to);
    const pct =
      hover.sourceVotes > 0 ? (hover.votes / hover.sourceVotes) * 100 : 0;
    body = (
      <>
        <div className="flex items-center gap-2 text-sm">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ backgroundColor: fromNode?.color ?? "#888" }}
          />
          <span className="font-medium truncate">
            {labelOf(fromNode, isEn)}
          </span>
          <span className="text-muted-foreground">→</span>
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ backgroundColor: toNode?.color ?? "#888" }}
          />
          <span className="font-medium truncate">{labelOf(toNode, isEn)}</span>
        </div>
        <div className="mt-1 text-sm tabular-nums">
          {formatThousands(hover.votes)}
          <span className="text-muted-foreground ml-2">
            ({pct.toFixed(1)}% {t("vote_flow_tooltip_of_source")})
          </span>
        </div>
      </>
    );
  } else {
    const node =
      hover.side === "from"
        ? matrix.fromNodes.find((n) => n.id === hover.id)
        : matrix.toNodes.find((n) => n.id === hover.id);
    if (!node) return null;
    const direction: "out" | "in" = hover.side === "from" ? "out" : "in";
    const matchKey = direction === "out" ? "from" : "to";
    const otherSideNodes =
      direction === "out" ? matrix.toNodes : matrix.fromNodes;
    const rows = sortAndSlice(matrix.flows, matchKey, node.id, PREVIEW_ROWS);
    const total = node.votes;
    body = (
      <>
        <div className="flex items-center gap-2 text-sm">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ backgroundColor: node.color }}
          />
          <span className="font-medium truncate">{labelOf(node, isEn)}</span>
        </div>
        <div className="mt-0.5 text-sm tabular-nums">
          {formatThousands(node.votes)}
        </div>
        {rows.length ? (
          <>
            <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              {direction === "out"
                ? t("vote_flow_tooltip_top_out")
                : t("vote_flow_tooltip_top_in")}
            </div>
            <ul className="mt-1 flex flex-col gap-0.5">
              {rows.map((f) => {
                const otherId = direction === "out" ? f.to : f.from;
                const other = otherSideNodes.find((n) => n.id === otherId);
                const pct = total > 0 ? (f.votes / total) * 100 : 0;
                return (
                  <li
                    key={`${node.id}->${otherId}`}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: other?.color ?? "#888" }}
                      />
                      <span className="truncate">{labelOf(other, isEn)}</span>
                    </div>
                    <span className="text-muted-foreground tabular-nums">
                      {pct.toFixed(0)}%
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 text-[10px] text-muted-foreground italic">
              {t("vote_flow_tooltip_click_hint")}
            </div>
          </>
        ) : null}
      </>
    );
  }

  return (
    <div
      role="tooltip"
      className={cn(
        "fixed z-50 pointer-events-none p-2.5",
        tooltipSurfaceClass,
      )}
      style={{ left, top, width: TOOLTIP_W }}
    >
      {body}
    </div>
  );
};
