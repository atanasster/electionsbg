import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Star } from "lucide-react";
import type {
  ConnectionsCompanyNode,
  ConnectionsEdge,
  ConnectionsNode,
  ConnectionsTopPair,
} from "@/data/dataTypes";
import { ConnectionPathRow } from "@/screens/components/candidates/ConnectionPathRow";
import { useWatchlist } from "./useWatchlist";
import { useMps } from "@/data/parliament/useMps";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { cn } from "@/lib/utils";

/** Highlight kind from the parliament-diff toggle. `null` means no diff. */
export type PairDiffKind = "new" | "carried" | "ended" | null;

type Props = {
  pairs: ConnectionsTopPair[];
  /** Optional cap so callers can show a teaser. Defaults to all pairs. */
  limit?: number;
  /** Optional resolver that maps a pair to its diff classification when the
   * parliament-diff toggle is active. Returns `null` to leave a pair
   * un-highlighted. */
  diffKindFor?: (pair: ConnectionsTopPair) => PairDiffKind;
};

/** Renders the global ranked list of MP↔MP connections as chip-chain rows.
 * Each pair carries its own `pathNodes`/`pathEdges`, so this component is
 * self-contained — no global graph fetch required. */
export const TopPairsList: FC<Props> = ({ pairs, limit, diffKindFor }) => {
  const { t } = useTranslation();
  const visible = useMemo(
    () => (limit ? pairs.slice(0, limit) : pairs),
    [pairs, limit],
  );

  if (visible.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center">
        {t("connections_no_pairs") ||
          "No MP↔MP connections match the current filters."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {visible.map((pair, idx) => (
        <TopPairRow
          key={`${pair.mpA.nodeId}|${pair.mpB.nodeId}|${idx}`}
          pair={pair}
          diffKind={diffKindFor?.(pair) ?? null}
        />
      ))}
    </div>
  );
};

const DIFF_BORDER: Record<NonNullable<PairDiffKind>, string> = {
  new: "border-l-emerald-500",
  carried: "border-l-neutral-400",
  ended: "border-l-rose-500",
};
const DIFF_LABEL: Record<NonNullable<PairDiffKind>, string> = {
  new: "connections_diff_new",
  carried: "connections_diff_carried",
  ended: "connections_diff_ended",
};
const DIFF_LABEL_FALLBACK: Record<NonNullable<PairDiffKind>, string> = {
  new: "new",
  carried: "carried over",
  ended: "ended",
};

const TopPairRow: FC<{
  pair: ConnectionsTopPair;
  diffKind: PairDiffKind;
}> = ({ pair, diffKind }) => {
  const { t } = useTranslation();
  const { isWatched, toggle } = useWatchlist();
  const { findMpById } = useMps();
  const { mpName } = useCandidateName();
  const aLabel = mpName(findMpById(pair.mpA.mpId)) || pair.mpA.label;
  const bLabel = mpName(findMpById(pair.mpB.mpId)) || pair.mpB.label;

  // Build the lookup tables ConnectionPathRow expects. The pair carries the
  // resolved nodes/edges so we never have to touch the global graph.
  const nodeById = useMemo(() => {
    const m = new Map<string, ConnectionsNode>();
    for (const n of pair.pathNodes) m.set(n.id, n);
    return m;
  }, [pair.pathNodes]);

  const edgeBetween = useMemo(() => {
    const map = new Map<string, ConnectionsEdge>();
    for (const e of pair.pathEdges) {
      const k =
        e.source < e.target
          ? `${e.source}|${e.target}`
          : `${e.target}|${e.source}`;
      map.set(k, e);
    }
    return (a: string, b: string) => {
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      return map.get(k);
    };
  }, [pair.pathEdges]);

  // Pick a representative TR URL for the "Source" link: the first company on
  // the path that has a UIC. Length-2 paths have exactly one, length-4 paths
  // typically have two — we use the first because it's closest to mpA.
  const trSourceUrl = useMemo(() => {
    for (const n of pair.pathNodes) {
      if (n.type !== "company") continue;
      const co = n as ConnectionsCompanyNode;
      if (co.uic) {
        return `https://portal.registryagency.bg/CR/en/Reports/VerifiedPersonShortInfo?uic=${co.uic}`;
      }
    }
    return null;
  }, [pair.pathNodes]);

  const watchedA = isWatched(pair.mpA.mpId);
  const watchedB = isWatched(pair.mpB.mpId);
  const anyWatched = watchedA || watchedB;

  return (
    <div
      className={cn(
        "rounded border border-border/60",
        diffKind && `border-l-4 ${DIFF_BORDER[diffKind]}`,
        anyWatched && "ring-1 ring-amber-400",
      )}
    >
      <ConnectionPathRow
        path={pair.path}
        nodeById={nodeById}
        edgeBetween={edgeBetween}
      />
      <div className="flex items-center gap-3 px-3 pb-2 -mt-1 text-[10px] text-muted-foreground">
        {diffKind && (
          <span className="uppercase tracking-wide font-medium">
            {t(DIFF_LABEL[diffKind]) || DIFF_LABEL_FALLBACK[diffKind]}
          </span>
        )}
        <button
          type="button"
          onClick={() => toggle(pair.mpA.mpId)}
          className="inline-flex items-center gap-0.5 hover:text-foreground"
          aria-label={`Watch ${aLabel}`}
        >
          <Star
            className={cn(
              "h-3 w-3",
              watchedA ? "fill-amber-400 text-amber-500" : "",
            )}
          />
          <span className="truncate max-w-[10rem]">{aLabel}</span>
        </button>
        <button
          type="button"
          onClick={() => toggle(pair.mpB.mpId)}
          className="inline-flex items-center gap-0.5 hover:text-foreground"
          aria-label={`Watch ${bLabel}`}
        >
          <Star
            className={cn(
              "h-3 w-3",
              watchedB ? "fill-amber-400 text-amber-500" : "",
            )}
          />
          <span className="truncate max-w-[10rem]">{bLabel}</span>
        </button>
        {trSourceUrl && (
          <a
            href={trSourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto inline-flex items-center gap-1 hover:text-foreground"
          >
            {t("connections_evidence_link") || "Source: TR"}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
};
