import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { KIND_DOT } from "./kindDot";
import type { DataMapKind, DataMapNode } from "@/data/dataMap/useDataMap";

export type NodeStatus =
  | "base"
  | "dim"
  | "hot"
  /** A lateral-link neighbour of the selection — distinct from lineage "hot". */
  | "linked"
  | "selected";

export type CardNodeData = {
  node: DataMapNode;
  lang: "bg" | "en";
  status: NodeStatus;
  fresh: boolean;
  freshTitle?: string;
  kindLabel: string;
  /** Active lens colour (CSS expression) — overrides the kind dot/tint. */
  lensColor?: string;
  /**
   * Lineage edges this VIEW does not show, and the words for them. A view's
   * membership is curated per node and does not follow lineage, so a card can
   * lose every arrow in one direction — and on a page about provenance, a card
   * with no arrows reads as an answer rather than as an omission.
   */
  hidden?: number;
  hiddenTitle?: string;
  onActivate: (id: string) => void;
};

export type TierNodeData = {
  label: string;
};

export type CardNodeType = Node<CardNodeData, "card">;
export type TierNodeType = Node<TierNodeData, "tier">;

const KIND_TINT: Record<DataMapKind, string> = {
  source: "bg-card",
  dataset: "bg-[hsl(var(--chart-2)/0.07)]",
  feature: "bg-[hsl(var(--accent)/0.07)]",
};

const handleClass = "!h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent";

export const DataMapNodeCard = memo(({ data }: NodeProps<CardNodeType>) => {
  const {
    node,
    lang,
    status,
    fresh,
    freshTitle,
    kindLabel,
    lensColor,
    hidden,
    hiddenTitle,
    onActivate,
  } = data;
  return (
    <div
      role="button"
      tabIndex={0}
      style={
        lensColor
          ? { background: `color-mix(in srgb, ${lensColor} 12%, transparent)` }
          : undefined
      }
      aria-label={`${kindLabel}: ${node.label[lang]}`}
      aria-pressed={status === "selected"}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate(node.id);
        }
      }}
      className={cn(
        "relative h-full w-full rounded-lg border px-3 py-2 text-left",
        "transition-[opacity,border-color,box-shadow] duration-200 cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        KIND_TINT[node.kind],
        status === "dim"
          ? "opacity-[0.16]"
          : status === "selected"
            ? "border-accent shadow-[0_0_0_2px_hsl(var(--accent)/0.55)]"
            : status === "linked"
              ? "border-accent/40 border-dashed"
              : status === "hot"
                ? "border-accent/70"
                : "border-border hover:border-accent/60",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={handleClass}
        isConnectable={false}
      />
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          aria-hidden
          style={lensColor ? { background: lensColor } : undefined}
          className={cn("h-2 w-2 rounded-full shrink-0", KIND_DOT[node.kind])}
        />
        <span className="truncate text-[13px] font-semibold leading-tight text-foreground">
          {node.label[lang]}
        </span>
      </div>
      <p className="mt-0.5 truncate pl-3.5 text-[11px] leading-tight text-muted-foreground">
        {node.detail[lang]}
      </p>
      {hidden && status !== "dim" ? (
        <span
          title={hiddenTitle}
          className="absolute bottom-1 right-1.5 rounded-full bg-secondary px-1.5 text-[10px] font-medium leading-4 text-muted-foreground"
        >
          +{hidden}
        </span>
      ) : null}
      {fresh && status !== "dim" ? (
        <span
          title={freshTitle}
          className="absolute -right-1 -top-1 flex h-3 w-3"
          aria-hidden
        >
          <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-background bg-accent" />
        </span>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        className={handleClass}
        isConnectable={false}
      />
      {/* Lateral links join two cards in the SAME column, which are stacked
          vertically — a Right→Left edge would exit the side, wrap around and
          cross every card between them. These are attached to by id.

          ⚠️ ORDER MATTERS, and getting it wrong is invisible. React Flow reads
          handleBounds.source as querySelectorAll(".source") in DOM order, and a
          lineage edge sets no sourceHandle, so it takes source[0]. With these
          rendered BEFORE the Right handle, all 108 dataset→feature edges left
          from the card's top-centre instead of its right edge — a silent
          regression on the pre-existing layer. Keep them last. */}
      {node.kind === "dataset" && (
        <>
          <Handle
            id="lat-t"
            type="source"
            position={Position.Top}
            className={handleClass}
            isConnectable={false}
          />
          <Handle
            id="lat-b"
            type="source"
            position={Position.Bottom}
            className={handleClass}
            isConnectable={false}
          />
        </>
      )}
    </div>
  );
});
DataMapNodeCard.displayName = "DataMapNodeCard";

export const DataMapTierFrame = memo(({ data }: NodeProps<TierNodeType>) => (
  <div className="h-full w-full rounded-2xl border border-dashed border-border/80">
    <span className="absolute left-5 top-3 text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">
      {data.label}
    </span>
  </div>
));
DataMapTierFrame.displayName = "DataMapTierFrame";
