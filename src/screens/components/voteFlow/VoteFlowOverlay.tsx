import {
  FC,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { VoteFlowMatrix, VoteFlowNode } from "@/data/voteFlows/voteFlowTypes";
import { formatThousands } from "@/data/utils";
import { tooltipSurfacePanelClass } from "@/components/ui/tooltipSurface";
import { cn } from "@/lib/utils";

// Pinned details panel for a clicked Sankey node. Floats inside the chart's
// container (relative-positioned ancestor); positions itself opposite the
// clicked node's side so the node itself stays visible. Dismissed by:
//   • clicking the X button
//   • pressing ESC
//   • clicking outside the panel (handled by the parent tile)

const ROW_LIMIT = 8;

const sortAndSlice = (
  flows: VoteFlowMatrix["flows"],
  matchKey: "from" | "to",
  matchId: string,
) =>
  flows
    .filter((f) => f[matchKey] === matchId)
    .sort((a, b) => b.votes - a.votes)
    .slice(0, ROW_LIMIT);

type Props = {
  matrix: VoteFlowMatrix;
  /** Node id to render details for. */
  nodeId: string;
  /** Anchor: which side of the chart was clicked. The panel opens on the
   * opposite side. */
  anchorSide: "from" | "to";
  /** Vertical anchor (0..1) within the chart. The panel's centre is placed
   * at this fraction of the container height, then clamped. */
  anchorYFrac: number;
  onClose: () => void;
  /** Click another node id to swap focus without closing the panel. */
  onSelectNode: (id: string) => void;
};

export const VoteFlowOverlay: FC<Props> = ({
  matrix,
  nodeId,
  anchorSide,
  anchorYFrac,
  onClose,
  onSelectNode,
}) => {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === "en";
  const ref = useRef<HTMLDivElement | null>(null);

  // Resolved pixel `top` after measuring panel + container heights. We can't
  // anchor the panel by percentage alone — a tall panel anchored near the
  // chart's edge gets pushed past the StatCard's `overflow: hidden` boundary
  // and visibly clips at the top. Instead, after mount we read the panel's
  // actual height and clamp it to fit inside its positioned parent.
  const [topPx, setTopPx] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const compute = () => {
      const panelH = el.offsetHeight;
      const containerH = parent.clientHeight;
      const desiredCenter = anchorYFrac * containerH;
      const PADDING = 8;
      const minTop = PADDING;
      // If the panel is taller than the container minus padding, fall back
      // to pinning it to the top — the inner overflow handles the rest.
      const maxTop = Math.max(minTop, containerH - panelH - PADDING);
      const clamped = Math.min(
        maxTop,
        Math.max(minTop, desiredCenter - panelH / 2),
      );
      setTopPx(clamped);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [anchorYFrac, nodeId]);

  // ESC dismisses; mounted-only.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fromNode = matrix.fromNodes.find((n) => n.id === nodeId);
  const toNode = matrix.toNodes.find((n) => n.id === nodeId);
  const labelOf = (n: VoteFlowNode | undefined) =>
    n ? (isEn ? n.labelEn : n.label) : "—";

  const outflows = useMemo(
    () => (fromNode ? sortAndSlice(matrix.flows, "from", fromNode.id) : []),
    [matrix.flows, fromNode],
  );
  const inflows = useMemo(
    () => (toNode ? sortAndSlice(matrix.flows, "to", toNode.id) : []),
    [matrix.flows, toNode],
  );

  // Positioning: the panel opens on the opposite side of the chart from the
  // anchor so it doesn't cover the node the user just clicked.
  const sideStyle: React.CSSProperties =
    anchorSide === "from" ? { right: 8 } : { left: 8 };

  const headerNode = fromNode ?? toNode;
  if (!headerNode) return null;

  const renderRows = (
    direction: "out" | "in",
    rows: VoteFlowMatrix["flows"],
    pivotTotal: number,
  ) => {
    if (!rows.length) return null;
    const otherNodes = direction === "out" ? matrix.toNodes : matrix.fromNodes;
    return (
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          {direction === "out"
            ? t("vote_flow_overlay_out")
            : t("vote_flow_overlay_in")}
        </div>
        <ul className="flex flex-col">
          {rows.map((f) => {
            const otherId = direction === "out" ? f.to : f.from;
            const other = otherNodes.find((n) => n.id === otherId);
            const pct = pivotTotal > 0 ? (f.votes / pivotTotal) * 100 : 0;
            return (
              <li
                key={`${direction}-${nodeId}-${otherId}`}
                className="flex items-center justify-between gap-2 px-1 py-0.5 rounded text-xs hover:bg-muted/60 cursor-pointer"
                onClick={() => other && onSelectNode(other.id)}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: other?.color ?? "#888" }}
                  />
                  <span className="truncate">{labelOf(other)}</span>
                </div>
                <div className="flex items-baseline gap-2 tabular-nums">
                  <span className="text-muted-foreground">
                    {pct.toFixed(1)}%
                  </span>
                  <span>{formatThousands(f.votes)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div
      ref={ref}
      data-vote-flow-overlay
      role="dialog"
      aria-label={labelOf(headerNode)}
      className={cn(
        "absolute z-20 w-[260px] max-h-[calc(100%-16px)] overflow-y-auto",
        tooltipSurfacePanelClass,
      )}
      style={{
        // While topPx is unmeasured (first paint), hide the panel rather
        // than render at an arbitrary location and snap into place.
        top: topPx ?? 0,
        visibility: topPx === null ? "hidden" : "visible",
        ...sideStyle,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
            style={{ backgroundColor: headerNode.color }}
          />
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">
              {labelOf(headerNode)}
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {formatThousands(headerNode.votes)}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("vote_flow_overlay_close")}
          className="text-muted-foreground hover:text-foreground p-0.5"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-3 flex flex-col gap-3">
        {renderRows("out", outflows, fromNode?.votes ?? 0)}
        {renderRows("in", inflows, toNode?.votes ?? 0)}
      </div>
    </div>
  );
};
