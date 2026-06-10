import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { DataMapKind, DataMapNode } from "@/data/dataMap/useDataMap";

export type NodeStatus = "base" | "dim" | "hot" | "selected";

export type CardNodeData = {
  node: DataMapNode;
  lang: "bg" | "en";
  status: NodeStatus;
  fresh: boolean;
  freshTitle?: string;
  kindLabel: string;
  /** Active lens colour (CSS expression) — overrides the kind dot/tint. */
  lensColor?: string;
  onActivate: (id: string) => void;
};

export type TierNodeData = {
  label: string;
};

export type CardNodeType = Node<CardNodeData, "card">;
export type TierNodeType = Node<TierNodeData, "tier">;

const KIND_DOT: Record<DataMapKind, string> = {
  source: "bg-[hsl(var(--muted-foreground))]",
  dataset: "bg-[hsl(var(--chart-2))]",
  feature: "bg-[hsl(var(--accent))]",
};

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
