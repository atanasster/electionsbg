import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Search, X } from "lucide-react";
import { useConnectionsGraph } from "@/data/parliament/useConnectionsGraph";
import type {
  ConnectionsEdge,
  ConnectionsGraph,
  ConnectionsMpNode,
  ConnectionsNode,
  ConnectionsPath,
} from "@/data/dataTypes";
import { ConnectionPathRow } from "@/screens/components/candidates/ConnectionPathRow";
import { cn } from "@/lib/utils";

type Props = {
  /** Selected NS folder used to scope the autocomplete suggestions. `null`
   * means "all parliaments" — autocomplete shows every MP. */
  scopedNs: string | null;
};

/** Shortest-path BFS over the global graph. Returns the chain plus the best
 * edge per consecutive node pair, so the UI can render it as a chip chain
 * directly via ConnectionPathRow. */
const findPath = (
  graph: ConnectionsGraph,
  fromId: string,
  toId: string,
): { path: ConnectionsPath; pathEdges: ConnectionsEdge[] } | null => {
  if (fromId === toId) return null;

  const adj = new Map<
    string,
    Array<{ neighbor: string; edge: ConnectionsEdge }>
  >();
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)!.push({ neighbor: e.target, edge: e });
    adj.get(e.target)!.push({ neighbor: e.source, edge: e });
  }

  const prev = new Map<string, string | null>();
  prev.set(fromId, null);
  const queue: string[] = [fromId];
  let found = false;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === toId) {
      found = true;
      break;
    }
    for (const { neighbor } of adj.get(cur) ?? []) {
      if (prev.has(neighbor)) continue;
      prev.set(neighbor, cur);
      queue.push(neighbor);
    }
  }
  if (!found) return null;

  const chain: string[] = [];
  for (
    let cur: string | null = toId;
    cur != null;
    cur = prev.get(cur) ?? null
  ) {
    chain.unshift(cur);
  }

  // Best edge per consecutive pair: prefer current + high-confidence.
  const score = (e: ConnectionsEdge) =>
    (e.isCurrent ? 2 : 0) + (e.confidence === "high" ? 1 : 0);
  const pickEdge = (a: string, b: string): ConnectionsEdge | undefined => {
    let best: ConnectionsEdge | undefined;
    for (const { neighbor, edge } of adj.get(a) ?? []) {
      if (neighbor !== b) continue;
      if (!best || score(edge) > score(best)) best = edge;
    }
    return best;
  };

  const pathEdges: ConnectionsEdge[] = [];
  let isAllCurrent = true;
  let isAllHighConfidence = true;
  for (let i = 0; i < chain.length - 1; i++) {
    const e = pickEdge(chain[i], chain[i + 1]);
    if (!e) {
      isAllCurrent = false;
      isAllHighConfidence = false;
      continue;
    }
    pathEdges.push(e);
    if (!e.isCurrent) isAllCurrent = false;
    if (e.confidence !== "high") isAllHighConfidence = false;
  }

  const path: ConnectionsPath = {
    targetMpNodeId: toId,
    length: chain.length - 1,
    nodeIds: chain,
    isAllCurrent,
    isAllHighConfidence,
  };
  return { path, pathEdges };
};

/** Two-MP shortest-path finder. Replaces the old "click a node on the canvas"
 * flow with a first-class autocomplete-driven UI. */
export const FindConnectionTab: FC<Props> = ({ scopedNs }) => {
  const { t } = useTranslation();
  const { graph, isLoading } = useConnectionsGraph();
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);

  // Build the MP autocomplete pool. When a parliament is selected, default
  // to that NS's MPs; users can clear the scope from the filter rail (Phase 4)
  // to widen.
  const mpOptions = useMemo<ConnectionsMpNode[]>(() => {
    if (!graph) return [];
    const all = graph.nodes.filter(
      (n): n is ConnectionsMpNode => n.type === "mp",
    );
    if (!scopedNs) return all;
    return all.filter((n) => n.nsFolders.includes(scopedNs));
  }, [graph, scopedNs]);

  const result = useMemo(() => {
    if (!graph || !fromId || !toId) return null;
    return findPath(graph, fromId, toId);
  }, [graph, fromId, toId]);

  const nodeById = useMemo(() => {
    const m = new Map<string, ConnectionsNode>();
    if (graph) for (const n of graph.nodes) m.set(n.id, n);
    return m;
  }, [graph]);

  const edgeBetween = useMemo(() => {
    if (!result) return () => undefined;
    const map = new Map<string, ConnectionsEdge>();
    for (const e of result.pathEdges) {
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
  }, [result]);

  const fromNode = fromId ? (nodeById.get(fromId) as ConnectionsMpNode) : null;
  const toNode = toId ? (nodeById.get(toId) as ConnectionsMpNode) : null;

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        {t("connections_find_intro") ||
          "Pick any two MPs — we'll find the shortest path between them through declared companies and shared associates."}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto] gap-2 items-center">
        <MpPicker
          label={t("connections_find_from") || "From"}
          value={fromNode}
          onChange={(n) => setFromId(n?.id ?? null)}
          options={mpOptions}
        />
        <ArrowRight className="hidden md:block h-4 w-4 text-muted-foreground" />
        <MpPicker
          label={t("connections_find_to") || "To"}
          value={toNode}
          onChange={(n) => setToId(n?.id ?? null)}
          options={mpOptions.filter((n) => n.id !== fromId)}
        />
        <button
          type="button"
          onClick={() => {
            setFromId(null);
            setToId(null);
          }}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <X className="h-3 w-3" />
          {t("connections_find_reset") || "Reset"}
        </button>
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground py-6 text-center">
          {t("connections_find_loading") || "Loading the connections graph…"}
        </div>
      )}

      {!isLoading && fromId && toId && !result && (
        <div className="text-sm text-amber-700 py-6 text-center">
          {t("connections_find_no_path") ||
            "No path was found between these two MPs through declared companies or shared associates."}
        </div>
      )}

      {result && fromNode && toNode && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            {t("connections_find_result") || "Shortest path"}
          </div>
          <ConnectionPathRow
            path={result.path}
            nodeById={nodeById}
            edgeBetween={edgeBetween}
          />
        </div>
      )}

      {!isLoading && !fromId && !toId && (
        <div className="rounded-lg border border-dashed border-border/60 p-6 text-center">
          <Search className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <div className="text-sm text-muted-foreground">
            {t("connections_find_empty") ||
              "Pick a starting MP above to begin."}
          </div>
        </div>
      )}
    </div>
  );
};

type PickerProps = {
  label: string;
  value: ConnectionsMpNode | null;
  onChange: (n: ConnectionsMpNode | null) => void;
  options: ConnectionsMpNode[];
};

/** Simple typeahead — substring match on label, case-insensitive. Up to 8
 * suggestions visible to keep the dropdown scannable. */
const MpPicker: FC<PickerProps> = ({ label, value, onChange, options }) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 8);
    return options.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 8);
  }, [query, options]);

  if (value) {
    return (
      <div className="rounded border border-border/60 px-2 py-1.5 text-sm flex items-center gap-2">
        <span className="text-muted-foreground text-[10px] uppercase tracking-wide shrink-0">
          {label}
        </span>
        <Link
          to={`/candidate/${encodeURIComponent(value.label)}`}
          className="font-medium hover:underline truncate flex-1"
        >
          {value.label}
        </Link>
        {value.partyGroupShort && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {value.partyGroupShort}
          </span>
        )}
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Clear"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={label}
        className="w-full rounded border border-border/60 px-2 py-1.5 text-sm bg-background"
      />
      {open && suggestions.length > 0 && (
        <div
          className={cn(
            "absolute z-20 mt-1 left-0 right-0 max-h-72 overflow-auto",
            "rounded border border-border/60 bg-background shadow-md",
          )}
        >
          {suggestions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(opt);
                setQuery("");
                setOpen(false);
              }}
              className="block w-full text-left px-2 py-1 text-sm hover:bg-muted"
            >
              <span className="truncate">{opt.label}</span>
              {opt.partyGroupShort && (
                <span className="ml-2 text-[10px] text-muted-foreground">
                  {opt.partyGroupShort}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
