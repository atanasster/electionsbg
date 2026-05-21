import {
  FC,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { Title } from "@/ux/Title";
import { Card, CardContent } from "@/ux/Card";
import { useConnectionsGraph } from "@/data/parliament/useConnectionsGraph";
import { useConnectionsRankings } from "@/data/parliament/useConnectionsRankings";
import { useConnectionsTopPairs } from "@/data/parliament/useConnectionsTopPairs";
import { useElectionContext } from "@/data/ElectionContext";
import { TopPairsList } from "@/screens/components/connections/TopPairsList";
import {
  exportPairsCsv,
  downloadCsv,
} from "@/screens/components/connections/exportPairsCsv";
import { FilterRail } from "@/screens/components/connections/FilterRail";
import { ConnectionsHero } from "@/screens/components/connections/ConnectionsHero";
import { OfficialRankingsCard } from "@/screens/components/connections/OfficialRankingsCard";
import { useConnectionsFilters } from "@/screens/components/connections/useConnectionsFilters";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useMps } from "@/data/parliament/useMps";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import type {
  ConnectionsEdge,
  ConnectionsGraph,
  ConnectionsNode,
  ConnectionsTopPair,
} from "@/data/dataTypes";

// d3-force mutates nodes in place — extend our typed node with the simulation
// fields it adds. We carry the original node fields too so the renderer can
// branch on `.type`.
type SimNode = ConnectionsNode &
  SimulationNodeDatum & {
    radius: number;
    color: string;
  };
type SimLink = SimulationLinkDatum<SimNode> & ConnectionsEdge;

const TYPE_COLORS: Record<ConnectionsNode["type"], string> = {
  mp: "#2563eb", // blue
  company: "#d97706", // amber/gold
  person: "#737373", // gray
  official: "#0d9488", // teal
};

const radiusForDegree = (degree: number): number =>
  3 + Math.min(7, Math.sqrt(degree) * 1.5);

type Filters = {
  hideTransferred: boolean;
  largestComponentOnly: boolean;
};

/** Group connected nodes into their connected-component id (returned as the
 * smallest node id in each component). */
const computeComponents = (
  nodes: SimNode[],
  links: SimLink[],
): Map<string, string> => {
  const adj = new Map<string, Set<string>>();
  for (const e of links) {
    const s = e.source as string;
    const t = e.target as string;
    if (!adj.has(s)) adj.set(s, new Set());
    if (!adj.has(t)) adj.set(t, new Set());
    adj.get(s)!.add(t);
    adj.get(t)!.add(s);
  }
  const componentOf = new Map<string, string>();
  for (const n of nodes) {
    if (componentOf.has(n.id)) continue;
    const cid = n.id;
    componentOf.set(n.id, cid);
    const queue: string[] = [n.id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (componentOf.has(next)) continue;
        componentOf.set(next, cid);
        queue.push(next);
      }
    }
  }
  return componentOf;
};

const buildSimNodes = (
  graph: ConnectionsGraph,
  filters: Filters,
  currentOnly: boolean,
  highConfidenceOnly: boolean,
  hiddenTypes: Set<ConnectionsNode["type"]>,
): {
  simNodes: SimNode[];
  simLinks: SimLink[];
  degree: Map<string, number>;
} => {
  // Filter edges first so we can drop orphan nodes. `currentOnly` and
  // `highConfidenceOnly` come from the page-level FilterRail (shared with the
  // strongest-connections list); `filters.hideTransferred` and
  // `filters.largestComponentOnly` are graph-only layout knobs; `hiddenTypes`
  // are node kinds toggled off via the legend.
  const typeById = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const filteredEdges = graph.edges.filter((e) => {
    if (currentOnly && !e.isCurrent) return false;
    if (filters.hideTransferred && e.role === "transferred_share") return false;
    if (highConfidenceOnly && e.confidence !== "high") return false;
    if (hiddenTypes.size > 0) {
      const st = typeById.get(e.source);
      const tt = typeById.get(e.target);
      if ((st && hiddenTypes.has(st)) || (tt && hiddenTypes.has(tt))) {
        return false;
      }
    }
    return true;
  });

  const degree = new Map<string, number>();
  for (const e of filteredEdges) {
    degree.set(e.source as string, (degree.get(e.source as string) ?? 0) + 1);
    degree.set(e.target as string, (degree.get(e.target as string) ?? 0) + 1);
  }

  let simNodes: SimNode[] = [];
  for (const n of graph.nodes) {
    if (hiddenTypes.has(n.type)) continue; // legend-toggled off
    const d = degree.get(n.id) ?? 0;
    if (d === 0) continue; // drop orphans after filtering
    simNodes.push({
      ...n,
      radius: radiusForDegree(d),
      color: TYPE_COLORS[n.type],
    });
  }

  let simLinks: SimLink[] = filteredEdges.map((e) => ({ ...e }));

  if (filters.largestComponentOnly && simNodes.length > 0) {
    const comp = computeComponents(simNodes, simLinks);
    const sizeByComp = new Map<string, number>();
    for (const cid of comp.values())
      sizeByComp.set(cid, (sizeByComp.get(cid) ?? 0) + 1);
    let bestCid: string | null = null;
    let bestSize = -1;
    for (const [cid, size] of sizeByComp.entries()) {
      if (size > bestSize) {
        bestSize = size;
        bestCid = cid;
      }
    }
    if (bestCid != null) {
      simNodes = simNodes.filter((n) => comp.get(n.id) === bestCid);
      simLinks = simLinks.filter(
        (e) =>
          comp.get(e.source as string) === bestCid &&
          comp.get(e.target as string) === bestCid,
      );
    }
  }

  return { simNodes, simLinks, degree };
};

export const ConnectionsScreen: FC = () => {
  const { t } = useTranslation();
  const { graph, isLoading } = useConnectionsGraph();
  const { rankings } = useConnectionsRankings();
  const { topPairs } = useConnectionsTopPairs();
  const { selected: selectedElection } = useElectionContext();
  const { partyGroupShortLabel } = useCanonicalParties();
  const { findMpById } = useMps();
  const { mpName } = useCandidateName();
  // The connections rankings + graph JSON ship pre-rendered Bulgarian `label`
  // strings for MP nodes; recover the MP record by id and use the locale-aware
  // accessor so EN routes show the canonical English name without re-baking
  // the JSON. Falls back to `label` for non-MP nodes (companies, addresses).
  const localizedMpLabel = useCallback(
    (mpId: number | null | undefined, fallback: string): string => {
      if (mpId == null) return fallback;
      const mp = findMpById(mpId);
      return mp ? mpName(mp) : fallback;
    },
    [findMpById, mpName],
  );
  // Path-finder endpoints are any person-type node (MP, official, or other
  // person) — everything except companies. MP labels go through the locale-
  // aware accessor; officials and other persons use `label`.
  const endpointLabel = useCallback(
    (n: SimNode): string =>
      n.type === "mp" ? localizedMpLabel(n.mpId, n.label) : n.label,
    [localizedMpLabel],
  );
  // Human-readable relationship for one path hop: the role the person/MP/
  // official holds at the company. `declared` flags a declared-stake edge so
  // the UI can colour it like the graph's declared-stake links; `inferred`
  // marks a medium-confidence hop (resolved only by a name match).
  const edgeRelationLabel = useCallback(
    (edge: ConnectionsEdge | undefined) => {
      if (!edge) return null;
      // i18next returns the key itself when a key is missing — treat that as
      // "untranslated" and fall back to a plain-English literal.
      const tr = (key: string, fallback: string): string => {
        const v = t(key);
        return v && v !== key ? v : fallback;
      };
      let text =
        edge.kind === "declared_stake"
          ? tr("connections_edge_declared_stake", "declared stake")
          : tr(`tr_role_${edge.role}`, edge.role);
      if (!edge.isCurrent) {
        text = `${text} · ${tr("connections_edge_former", "former")}`;
      }
      const inferred = edge.confidence === "medium";
      return {
        text,
        declared: edge.kind === "declared_stake",
        inferred,
        inferredTitle: inferred
          ? tr(
              "connections_edge_inferred",
              "Inferred from a name match — not a corroborated record",
            )
          : undefined,
      };
    },
    [t],
  );
  // Filter state — lifted into the URL via useConnectionsFilters so all chips
  // are shareable and back-button friendly.
  const {
    filters: connFilters,
    setNs,
    setCrossParty,
    setCurrentOnly,
    setHighConfidenceOnly,
    setPartyPair,
    resetAll,
  } = useConnectionsFilters(selectedElection);
  const selectedNs = connFilters.ns;

  // Scoped top pairs — apply NS scope (at least one endpoint sat in the
  // selected NS), plus the rail's cross-party / currency / confidence
  // filters. We don't require *both* endpoints in the selected NS because
  // the most useful current-parliament view often surfaces "current MP X
  // with ties to former MP Y" — the per-pair metadata still tells the user
  // which parliament each endpoint came from.
  const scopedPairs = useMemo(() => {
    if (!topPairs) return [];
    return topPairs.pairs.filter((p) => {
      if (
        selectedNs &&
        !p.mpA.nsFolders.includes(selectedNs) &&
        !p.mpB.nsFolders.includes(selectedNs)
      ) {
        return false;
      }
      if (connFilters.crossParty && !p.crossParty) return false;
      if (connFilters.currentOnly && !p.path.isAllCurrent) return false;
      if (connFilters.highConfidenceOnly && !p.path.isAllHighConfidence)
        return false;
      if (connFilters.partyPair) {
        const [a, b] = connFilters.partyPair;
        const pa = p.mpA.partyGroupShort ?? "Independent";
        const pb = p.mpB.partyGroupShort ?? "Independent";
        const matches = (pa === a && pb === b) || (pa === b && pb === a);
        if (!matches) return false;
      }
      return true;
    });
  }, [
    topPairs,
    selectedNs,
    connFilters.crossParty,
    connFilters.currentOnly,
    connFilters.highConfidenceOnly,
    connFilters.partyPair,
  ]);

  const availableNsFolders = useMemo(
    () => (rankings ? Object.keys(rankings.byNs ?? {}) : []),
    [rankings],
  );

  // Parliament-diff mode — when on, compare scopedPairs against the prior
  // parliament's pairs. We classify each pair as new (only in selectedNs),
  // carried (in both), or ended (only in priorNs). Off by default.
  const [diffMode, setDiffMode] = useState(false);
  const priorNs = useMemo(() => {
    if (!selectedNs) return null;
    const n = Number(selectedNs);
    return Number.isFinite(n) && n > 1 ? String(n - 1) : null;
  }, [selectedNs]);

  const diffPairs = useMemo(() => {
    if (!diffMode || !topPairs || !selectedNs || !priorNs)
      return { merged: scopedPairs, kind: () => null as null };

    const inSelected = (p: ConnectionsTopPair) =>
      p.mpA.nsFolders.includes(selectedNs) ||
      p.mpB.nsFolders.includes(selectedNs);
    const inPrior = (p: ConnectionsTopPair) =>
      p.mpA.nsFolders.includes(priorNs) || p.mpB.nsFolders.includes(priorNs);

    const filterByRailToggles = (p: ConnectionsTopPair) => {
      if (connFilters.crossParty && !p.crossParty) return false;
      if (connFilters.currentOnly && !p.path.isAllCurrent) return false;
      if (connFilters.highConfidenceOnly && !p.path.isAllHighConfidence)
        return false;
      if (connFilters.partyPair) {
        const [a, b] = connFilters.partyPair;
        const pa = p.mpA.partyGroupShort ?? "Independent";
        const pb = p.mpB.partyGroupShort ?? "Independent";
        if (!((pa === a && pb === b) || (pa === b && pb === a))) return false;
      }
      return true;
    };

    const candidatesAfterToggles = topPairs.pairs.filter(filterByRailToggles);
    const merged: ConnectionsTopPair[] = [];
    const kindMap = new Map<string, "new" | "carried" | "ended">();
    for (const p of candidatesAfterToggles) {
      const inSel = inSelected(p);
      const inPri = inPrior(p);
      if (!inSel && !inPri) continue;
      const key = `${p.mpA.nodeId}|${p.mpB.nodeId}`;
      if (inSel && inPri) kindMap.set(key, "carried");
      else if (inSel) kindMap.set(key, "new");
      else kindMap.set(key, "ended");
      merged.push(p);
    }

    return {
      merged,
      kind: (p: ConnectionsTopPair) => {
        const key = `${p.mpA.nodeId}|${p.mpB.nodeId}`;
        return kindMap.get(key) ?? null;
      },
    };
  }, [
    diffMode,
    topPairs,
    selectedNs,
    priorNs,
    scopedPairs,
    connFilters.crossParty,
    connFilters.currentOnly,
    connFilters.highConfidenceOnly,
    connFilters.partyPair,
  ]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Mirror the wrap element into state via a callback ref so effects can react
  // to it appearing in the DOM. Radix Tabs only mounts inactive panel content
  // when the user activates the tab, and that mount happens *after* React's
  // effect for the activeTab change has already run — so a plain useRef + tab
  // dep wouldn't catch it. The callback ref fires synchronously on mount.
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const canvasWrapRef = useCallback((el: HTMLDivElement | null) => {
    setWrapEl(el);
  }, []);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);

  // Camera (pan/zoom) maintained in plain refs so we re-render the canvas on
  // every simulation tick without restarting React. Drag-to-pan is supported
  // via mouse events on the canvas.
  const cameraRef = useRef({ x: 0, y: 0, scale: 1 });
  // When a connection path is found, the draw loop lerps the camera to frame
  // the whole trail. `deadline` bounds the animation if the layout never fully
  // settles; manual pan/zoom cancels it.
  const fitRef = useRef<{ active: boolean; deadline: number }>({
    active: false,
    deadline: 0,
  });
  const draggingRef = useRef<{ kind: "pan" | "node"; nodeId?: string } | null>(
    null,
  );
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  // The detail popover is positioned imperatively next to its node by the
  // draw loop. `popoverDataRef` mirrors the render-state the placement logic
  // needs so it can run from a stable callback.
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverDataRef = useRef<{
    simNodes: SimNode[];
    selectedId: string | null;
    w: number;
    h: number;
  }>({ simNodes: [], selectedId: null, w: 0, h: 0 });

  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hovered, setHovered] = useState<SimNode | null>(null);
  const [selected, setSelected] = useState<SimNode | null>(null);
  // Vertical bounds of the canvas that are currently inside the viewport, in
  // canvas-local px. The popover anchors to these instead of the canvas's own
  // top/bottom so it stays on-screen when the graph extends beyond the fold.
  const [visibleVRange, setVisibleVRange] = useState<{
    top: number;
    bottom: number;
  }>({ top: 0, bottom: 0 });
  // Ref mirror of visibleVRange so the RAF draw loop can read it without
  // re-subscribing the loop on every scroll event.
  const visibleVRangeRef = useRef({ top: 0, bottom: 0 });
  const [filters, setFilters] = useState<Filters>({
    hideTransferred: false,
    largestComponentOnly: false,
  });
  const [clusterByParty, setClusterByParty] = useState(false);
  // Node kinds toggled off via the legend chips.
  const [hiddenTypes, setHiddenTypes] = useState<Set<ConnectionsNode["type"]>>(
    new Set(),
  );
  const toggleType = (type: ConnectionsNode["type"]) =>
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  // Path-finding: when two MPs are picked, BFS the unfiltered graph to find
  // the shortest path between them, then highlight it.
  const [pathPickMode, setPathPickMode] = useState(false);
  const [pathFrom, setPathFrom] = useState<SimNode | null>(null);
  const [pathTo, setPathTo] = useState<SimNode | null>(null);
  const [pathNodeIds, setPathNodeIds] = useState<Set<string> | null>(null);
  const [pathEdgeKeys, setPathEdgeKeys] = useState<Set<string> | null>(null);
  const [pathTrail, setPathTrail] = useState<string[] | null>(null);
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);
  const fromInputRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);

  // Resize observer keeps the canvas full-width within its card. Keyed off
  // wrapEl so it re-attaches whenever the wrapper mounts — Radix only mounts
  // inactive tab panels lazily, so the wrapper appears later than the parent
  // component's mount.
  useEffect(() => {
    if (!wrapEl) return;
    const ro = new ResizeObserver(() => {
      const rect = wrapEl.getBoundingClientRect();
      setSize({
        w: Math.max(320, Math.floor(rect.width)),
        h: Math.max(640, Math.floor(window.innerHeight - 80)),
      });
    });
    ro.observe(wrapEl);
    return () => ro.disconnect();
  }, [wrapEl]);

  // Track which vertical slice of the canvas is currently in the viewport so
  // the popover can anchor inside it (the canvas often extends past the fold).
  useEffect(() => {
    if (!wrapEl) return;
    const update = () => {
      const r = wrapEl.getBoundingClientRect();
      const top = Math.max(0, -r.top);
      const bottom = Math.min(r.height, window.innerHeight - r.top);
      visibleVRangeRef.current = { top, bottom };
      setVisibleVRange((prev) =>
        prev.top === top && prev.bottom === bottom ? prev : { top, bottom },
      );
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [wrapEl, size.h]);

  // Rebuild simulation when graph or filters change.
  const { simNodes, simLinks, neighbors } = useMemo(() => {
    if (!graph)
      return {
        simNodes: [] as SimNode[],
        simLinks: [] as SimLink[],
        neighbors: new Map<string, Set<string>>(),
      };
    const { simNodes, simLinks } = buildSimNodes(
      graph,
      filters,
      connFilters.currentOnly,
      connFilters.highConfidenceOnly,
      hiddenTypes,
    );
    const neighbors = new Map<string, Set<string>>();
    for (const e of simLinks) {
      const s = e.source as string;
      const t = e.target as string;
      if (!neighbors.has(s)) neighbors.set(s, new Set());
      if (!neighbors.has(t)) neighbors.set(t, new Set());
      neighbors.get(s)!.add(t);
      neighbors.get(t)!.add(s);
    }
    return { simNodes, simLinks, neighbors };
  }, [
    graph,
    filters,
    connFilters.currentOnly,
    connFilters.highConfidenceOnly,
    hiddenTypes,
  ]);

  // Map party group → angular target (radians) for clustering. Computed once
  // per simulation rebuild so partyAngle stays stable across ticks.
  const partyAngleByGroup = useMemo(() => {
    const groups = new Set<string>();
    for (const n of simNodes) {
      if (n.type === "mp" && n.partyGroupShort) groups.add(n.partyGroupShort);
    }
    const sorted = Array.from(groups).sort();
    const map = new Map<string, number>();
    sorted.forEach((g, i) => {
      map.set(g, (i / sorted.length) * Math.PI * 2);
    });
    return map;
  }, [simNodes]);

  useEffect(() => {
    if (simNodes.length === 0) return;
    const radius = 240; // cluster radius from origin

    const targetX = (n: SimNode): number => {
      if (!clusterByParty) return 0;
      if (n.type !== "mp" || !n.partyGroupShort) return 0;
      const a = partyAngleByGroup.get(n.partyGroupShort);
      return a == null ? 0 : Math.cos(a) * radius;
    };
    const targetY = (n: SimNode): number => {
      if (!clusterByParty) return 0;
      if (n.type !== "mp" || !n.partyGroupShort) return 0;
      const a = partyAngleByGroup.get(n.partyGroupShort);
      return a == null ? 0 : Math.sin(a) * radius;
    };

    const sim = forceSimulation<SimNode, SimLink>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((d) => (d.kind === "declared_stake" ? 60 : 80))
          .strength(0.4),
      )
      .force("charge", forceManyBody().strength(-80))
      .force("center", forceCenter(0, 0))
      .force(
        "x",
        forceX<SimNode>()
          .x(targetX)
          .strength(clusterByParty ? 0.15 : 0.04),
      )
      .force(
        "y",
        forceY<SimNode>()
          .y(targetY)
          .strength(clusterByParty ? 0.15 : 0.04),
      )
      .alpha(1)
      .alphaDecay(0.02);

    simRef.current = sim;
    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [simNodes, simLinks, clusterByParty, partyAngleByGroup]);

  // Pin the detail popover next to its node: prefer the right side, flip left
  // when it would overflow, and clamp vertically into the visible slice. Run
  // every frame by the draw loop (tracks camera/layout) and once on detail
  // change via useLayoutEffect (places it before the first paint, no flash).
  const positionDetailPopover = useCallback(() => {
    const pop = popoverRef.current;
    if (!pop) return;
    const { simNodes: sn, selectedId, w, h } = popoverDataRef.current;
    const id = selectedId ?? hoveredIdRef.current;
    const node = id ? sn.find((n) => n.id === id) : null;
    if (!node || node.x == null || node.y == null || w === 0) return;
    const cam = cameraRef.current;
    const nx = w / 2 + cam.x + node.x * cam.scale;
    const ny = h / 2 + cam.y + node.y * cam.scale;
    const nr = node.radius * cam.scale;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const gap = 14;
    const vr = visibleVRangeRef.current;
    const visTop = vr.bottom > vr.top ? vr.top : 0;
    const visBottom = vr.bottom > vr.top ? vr.bottom : h;
    let px = nx + nr + gap;
    if (px + pw > w - 8) px = nx - nr - gap - pw;
    px = Math.max(8, Math.min(px, w - pw - 8));
    let py = ny - ph / 2;
    py = Math.max(visTop + 8, Math.min(py, visBottom - ph - 8));
    pop.style.left = `${Math.round(px)}px`;
    pop.style.top = `${Math.round(py)}px`;
  }, []);

  // Render loop driven by RAF — reads simulation state, draws to canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      const { w, h } = size;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const cam = cameraRef.current;
      // Camera fit: ease the camera so the whole connection trail fits the
      // visible viewport, leaving room for the result popover on the right.
      const fit = fitRef.current;
      if (fit.active && pathNodeIds && pathNodeIds.size > 0) {
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity,
          count = 0;
        for (const node of simNodes) {
          if (!pathNodeIds.has(node.id) || node.x == null || node.y == null) {
            continue;
          }
          minX = Math.min(minX, node.x);
          maxX = Math.max(maxX, node.x);
          minY = Math.min(minY, node.y);
          maxY = Math.max(maxY, node.y);
          count++;
        }
        if (count > 0) {
          const vr = visibleVRangeRef.current;
          const visTop = vr.bottom > vr.top ? vr.top : 0;
          const visBottom = vr.bottom > vr.top ? vr.bottom : h;
          const padX = 70;
          const padR = Math.min(330, w * 0.4); // clear the result popover
          const padY = 60;
          const availW = Math.max(w - padX - padR, 80);
          const availH = Math.max(visBottom - visTop - 2 * padY, 80);
          const bw = Math.max(maxX - minX, 1);
          const bh = Math.max(maxY - minY, 1);
          // Allow the fit to zoom out further than the manual wheel floor
          // (0.2) so a long trail still fits a narrow viewport in full.
          const targetScale = Math.max(
            0.05,
            Math.min(2, availW / bw, availH / bh),
          );
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          const targetX = (padX - padR) / 2 - cx * targetScale;
          const targetY = (visTop + visBottom) / 2 - h / 2 - cy * targetScale;
          cam.x += (targetX - cam.x) * 0.16;
          cam.y += (targetY - cam.y) * 0.16;
          cam.scale += (targetScale - cam.scale) * 0.16;
          if (
            (Math.abs(targetX - cam.x) < 0.5 &&
              Math.abs(targetY - cam.y) < 0.5 &&
              Math.abs(targetScale - cam.scale) < 0.004) ||
            performance.now() > fit.deadline
          ) {
            cam.x = targetX;
            cam.y = targetY;
            cam.scale = targetScale;
            fit.active = false;
          }
        }
      }
      ctx.save();
      ctx.translate(w / 2 + cam.x, h / 2 + cam.y);
      ctx.scale(cam.scale, cam.scale);

      const hoveredId = hoveredIdRef.current;
      // Highlight set: the path takes precedence over hover.
      const highlightSet =
        pathNodeIds ??
        (hoveredId
          ? new Set([hoveredId, ...(neighbors.get(hoveredId) ?? [])])
          : null);

      // Edges
      ctx.lineWidth = 0.5 / cam.scale;
      for (const link of simLinks) {
        const s = link.source as SimNode;
        const tn = link.target as SimNode;
        if (s.x == null || tn.x == null) continue;
        const onPath = pathEdgeKeys && pathEdgeKeys.has(`${s.id}|${tn.id}`);
        const dimmed =
          highlightSet &&
          !onPath &&
          !(highlightSet.has(s.id) && highlightSet.has(tn.id));
        if (onPath) {
          ctx.strokeStyle = "#dc2626"; // red path
          ctx.lineWidth = 2 / cam.scale;
        } else {
          ctx.strokeStyle = dimmed
            ? "rgba(120,120,120,0.08)"
            : link.kind === "declared_stake"
              ? "rgba(37,99,235,0.45)"
              : "rgba(217,119,6,0.45)";
          ctx.lineWidth = 0.5 / cam.scale;
        }
        if (link.isCurrent) {
          ctx.setLineDash([]);
        } else {
          ctx.setLineDash([3, 3]);
        }
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(tn.x!, tn.y!);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineWidth = 0.5 / cam.scale;

      // Nodes
      for (const n of simNodes) {
        if (n.x == null || n.y == null) continue;
        const onPath = pathNodeIds?.has(n.id);
        const dimmed = highlightSet && !onPath && !highlightSet.has(n.id);
        ctx.beginPath();
        ctx.arc(n.x, n.y, onPath ? n.radius + 1.5 : n.radius, 0, Math.PI * 2);
        ctx.fillStyle = dimmed
          ? "rgba(170,170,170,0.4)"
          : onPath
            ? "#dc2626"
            : n.color;
        ctx.fill();
        const isEndpoint = n.id === pathFrom?.id || n.id === pathTo?.id;
        if (selected?.id === n.id || isEndpoint) {
          ctx.strokeStyle = isEndpoint ? "#dc2626" : "#000";
          ctx.lineWidth = 2 / cam.scale;
          ctx.stroke();
          ctx.lineWidth = 0.5 / cam.scale;
        }
      }

      // Labels for high-degree or hovered/selected nodes, drawn highest-
      // priority first. Each label takes the first of three slots (right /
      // left / below the node) that sits fully inside the canvas and clears
      // every label already placed; a label with no free slot is skipped, so
      // labels never overlap each other nor trail off the edge.
      ctx.fillStyle = "#222";
      ctx.font = `${11 / cam.scale}px system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      const labelGap = 2;
      const rowHalfH = 9 / cam.scale;
      const padX = 3 / cam.scale;
      const viewL = (-w / 2 - cam.x) / cam.scale;
      const viewR = (w / 2 - cam.x) / cam.scale;
      const viewT = (-h / 2 - cam.y) / cam.scale;
      const viewB = (h / 2 - cam.y) / cam.scale;
      const labelRank = (n: SimNode): number =>
        n.id === hoveredId
          ? 3
          : n.id === selected?.id
            ? 2
            : n.type === "mp"
              ? 1
              : 0;
      const placedLabels: {
        x0: number;
        y0: number;
        x1: number;
        y1: number;
      }[] = [];
      const labelNodes = simNodes
        .filter(
          (n) =>
            n.x != null &&
            n.y != null &&
            n.x >= viewL &&
            n.x <= viewR &&
            n.y >= viewT &&
            n.y <= viewB &&
            (n.id === hoveredId ||
              n.id === selected?.id ||
              n.radius > 6 / cam.scale + 2),
        )
        .sort((a, b) => labelRank(b) - labelRank(a) || b.radius - a.radius);
      for (const n of labelNodes) {
        const nx = n.x as number;
        const ny = n.y as number;
        const label =
          n.type === "mp" ? localizedMpLabel(n.mpId, n.label) : n.label;
        const tw = ctx.measureText(label).width;
        const rightX = nx + n.radius + labelGap;
        const leftX = nx - n.radius - labelGap;
        const belowTop = ny + n.radius + labelGap;
        const slots = [
          {
            align: "left" as CanvasTextAlign,
            tx: rightX,
            ty: ny,
            x0: rightX - padX,
            x1: rightX + tw + padX,
            y0: ny - rowHalfH,
            y1: ny + rowHalfH,
          },
          {
            align: "right" as CanvasTextAlign,
            tx: leftX,
            ty: ny,
            x0: leftX - tw - padX,
            x1: leftX + padX,
            y0: ny - rowHalfH,
            y1: ny + rowHalfH,
          },
          {
            align: "center" as CanvasTextAlign,
            tx: nx,
            ty: belowTop + rowHalfH,
            x0: nx - tw / 2 - padX,
            x1: nx + tw / 2 + padX,
            y0: belowTop,
            y1: belowTop + 2 * rowHalfH,
          },
        ];
        const inView = (s: (typeof slots)[number]): boolean =>
          s.x0 >= viewL && s.x1 <= viewR && s.y0 >= viewT && s.y1 <= viewB;
        const clear = (s: (typeof slots)[number]): boolean =>
          !placedLabels.some(
            (p) => s.x0 < p.x1 && s.x1 > p.x0 && s.y0 < p.y1 && s.y1 > p.y0,
          );
        const forced = n.id === hoveredId || n.id === selected?.id;
        let slot = slots.find((s) => inView(s) && clear(s));
        if (!slot && forced) slot = slots.find(inView) ?? slots[0];
        if (!slot) continue;
        ctx.textAlign = slot.align;
        ctx.fillText(label, slot.tx, slot.ty);
        placedLabels.push({
          x0: slot.x0,
          y0: slot.y0,
          x1: slot.x1,
          y1: slot.y1,
        });
      }
      ctx.textAlign = "left";

      ctx.restore();
      positionDetailPopover();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [
    size,
    simNodes,
    simLinks,
    neighbors,
    selected,
    pathNodeIds,
    pathEdgeKeys,
    pathFrom?.id,
    pathTo?.id,
    localizedMpLabel,
    positionDetailPopover,
  ]);

  // ---- Mouse interactions: hover, click, pan, drag node, zoom ----
  const screenToWorld = (sx: number, sy: number) => {
    const cam = cameraRef.current;
    return {
      x: (sx - size.w / 2 - cam.x) / cam.scale,
      y: (sy - size.h / 2 - cam.y) / cam.scale,
    };
  };

  const findNodeAt = (sx: number, sy: number): SimNode | null => {
    const { x, y } = screenToWorld(sx, sy);
    for (let i = simNodes.length - 1; i >= 0; i--) {
      const n = simNodes[i];
      if (n.x == null || n.y == null) continue;
      const dx = n.x - x;
      const dy = n.y - y;
      const r = n.radius + 2;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const drag = draggingRef.current;
    const last = lastMouseRef.current;
    if (drag && last) {
      const dx = sx - last.x;
      const dy = sy - last.y;
      // Any manual pan/node-drag cancels an in-flight fit animation.
      if (dx !== 0 || dy !== 0) fitRef.current.active = false;
      if (drag.kind === "pan") {
        cameraRef.current.x += dx;
        cameraRef.current.y += dy;
      } else if (drag.kind === "node" && drag.nodeId) {
        const n = simNodes.find((nn) => nn.id === drag.nodeId);
        if (n && n.x != null && n.y != null) {
          n.fx = (n.x ?? 0) + dx / cameraRef.current.scale;
          n.fy = (n.y ?? 0) + dy / cameraRef.current.scale;
        }
        simRef.current?.alphaTarget(0.3).restart();
      }
      lastMouseRef.current = { x: sx, y: sy };
      return;
    }
    const node = findNodeAt(sx, sy);
    hoveredIdRef.current = node?.id ?? null;
    setHovered(node);
    e.currentTarget.style.cursor = node ? "pointer" : "default";
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const node = findNodeAt(sx, sy);
    lastMouseRef.current = { x: sx, y: sy };
    if (node) {
      draggingRef.current = { kind: "node", nodeId: node.id };
    } else {
      draggingRef.current = { kind: "pan" };
    }
  };

  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = draggingRef.current;
    const last = lastMouseRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (drag?.kind === "node" && drag.nodeId) {
      // Release pin so the node settles back into the simulation.
      const n = simNodes.find((nn) => nn.id === drag.nodeId);
      if (n) {
        n.fx = null;
        n.fy = null;
      }
      simRef.current?.alphaTarget(0);
    }
    // Detect click (no drag distance)
    if (last && Math.abs(sx - last.x) < 3 && Math.abs(sy - last.y) < 3) {
      const node = findNodeAt(sx, sy);
      const isEndpoint = !!node && node.type !== "company";
      if (pathPickMode && node && isEndpoint) {
        if (!pathFrom) {
          setPathFrom(node);
        } else if (!pathTo && node.id !== pathFrom.id) {
          setPathTo(node);
          setPathPickMode(false);
          setSelected(null);
        } else if (node.id === pathFrom.id) {
          setPathFrom(null);
          setPathPickMode(false);
        }
      } else if (!pathPickMode && node && isEndpoint) {
        setSelected(node);
        setPathPickMode(true);
        setPathFrom(node);
        setPathTo(null);
      } else {
        setSelected(node);
      }
    }
    draggingRef.current = null;
    lastMouseRef.current = null;
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    // Only zoom on pinch (browsers set ctrlKey: true for trackpad pinch) or
    // explicit Ctrl/Cmd+wheel. Otherwise let trackpad/wheel scroll the page.
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    fitRef.current.active = false;
    const cam = cameraRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    // Anchor zoom on the cursor: keep the world point under it fixed.
    const wx = (sx - size.w / 2 - cam.x) / cam.scale;
    const wy = (sy - size.h / 2 - cam.y) / cam.scale;
    // Smooth, delta-proportional factor instead of a fixed step per event.
    const factor = Math.exp(-e.deltaY * 0.01);
    const newScale = Math.max(0.2, Math.min(5, cam.scale * factor));
    cam.x = sx - size.w / 2 - wx * newScale;
    cam.y = sy - size.h / 2 - wy * newScale;
    cam.scale = newScale;
  };

  // ---- Path-finding (BFS on the filtered neighbors map) ----------------
  useEffect(() => {
    if (!pathFrom || !pathTo) {
      setPathNodeIds(null);
      setPathEdgeKeys(null);
      setPathTrail(null);
      return;
    }
    // BFS
    const prev = new Map<string, string | null>();
    prev.set(pathFrom.id, null);
    const queue: string[] = [pathFrom.id];
    let found = false;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === pathTo.id) {
        found = true;
        break;
      }
      for (const next of neighbors.get(cur) ?? []) {
        if (prev.has(next)) continue;
        prev.set(next, cur);
        queue.push(next);
      }
    }
    if (!found) {
      setPathNodeIds(new Set([pathFrom.id, pathTo.id]));
      setPathEdgeKeys(new Set());
      setPathTrail(null);
      return;
    }
    const trail: string[] = [];
    for (
      let cur: string | null = pathTo.id;
      cur != null;
      cur = prev.get(cur) ?? null
    ) {
      trail.push(cur);
    }
    trail.reverse();
    const nodeSet = new Set(trail);
    const edgeSet = new Set<string>();
    for (let i = 0; i < trail.length - 1; i++) {
      // Each undirected pair could be (a,b) or (b,a) in the source link list.
      const a = trail[i];
      const b = trail[i + 1];
      edgeSet.add(`${a}|${b}`);
      edgeSet.add(`${b}|${a}`);
    }
    setPathNodeIds(nodeSet);
    setPathEdgeKeys(edgeSet);
    setPathTrail(trail);
  }, [pathFrom, pathTo, neighbors]);

  // Frame the connection result so it is never partly off-screen — the whole
  // trail when a path is found, or just the two endpoints when there is none
  // (so the user still sees where the disconnected pair sits). The draw loop
  // runs the camera lerp.
  useEffect(() => {
    if (pathNodeIds && pathNodeIds.size > 1) {
      fitRef.current = { active: true, deadline: performance.now() + 2500 };
    }
  }, [pathNodeIds]);

  // Sync canvas-click selections into the search inputs (but don't clear query
  // when pathFrom/pathTo is cleared by typing — that's handled by onChange).
  useEffect(() => {
    if (pathFrom) {
      setFromQuery(endpointLabel(pathFrom));
    }
  }, [pathFrom]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pathTo) {
      setToQuery(endpointLabel(pathTo));
    }
  }, [pathTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus the appropriate search input when entering pick mode.
  useEffect(() => {
    if (!pathPickMode) return;
    const timer = setTimeout(() => {
      if (!pathFrom) {
        fromInputRef.current?.focus();
      } else {
        toInputRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [pathPickMode, pathFrom?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Detail panel content ----
  const detail = selected ?? hovered;
  // While a path result is on screen its own popover owns the right side —
  // suppress the per-node detail popover so the two don't overlap.
  const pathResultVisible = !!(
    pathFrom &&
    pathTo &&
    pathNodeIds &&
    pathEdgeKeys
  );

  // Mirror the render-state the popover placement needs into a ref so the
  // stable positioning callback (and the draw loop) can read it.
  popoverDataRef.current = {
    simNodes,
    selectedId: selected?.id ?? null,
    w: size.w,
    h: size.h,
  };

  // Place the popover before the first paint so it never flashes at (0,0);
  // the draw loop then keeps it pinned as the camera/layout move.
  useLayoutEffect(() => {
    positionDetailPopover();
  }, [detail, size.w, size.h, positionDetailPopover]);

  const detailNeighbors = detail
    ? Array.from(neighbors.get(detail.id) ?? [])
        .map((id) => simNodes.find((n) => n.id === id))
        .filter((n): n is SimNode => !!n)
    : [];

  const stats = useMemo(() => {
    const counts = { mp: 0, company: 0, person: 0, official: 0 };
    for (const n of simNodes) counts[n.type]++;
    return { ...counts, edges: simLinks.length };
  }, [simNodes, simLinks]);

  const endpointNodes = useMemo(
    () => simNodes.filter((n) => n.type !== "company"),
    [simNodes],
  );

  // Best edge between each node pair (both orderings), so the path popover can
  // label every hop. "Best" = currently-active and high-confidence preferred,
  // matching how the canvas picks which parallel edge to draw.
  const edgeByPair = useMemo(() => {
    const m = new Map<string, SimLink>();
    const score = (e: SimLink) =>
      (e.isCurrent ? 2 : 0) + (e.confidence === "high" ? 1 : 0);
    for (const link of simLinks) {
      const s =
        typeof link.source === "object"
          ? (link.source as SimNode).id
          : String(link.source);
      const tg =
        typeof link.target === "object"
          ? (link.target as SimNode).id
          : String(link.target);
      for (const k of [`${s}|${tg}`, `${tg}|${s}`]) {
        const prev = m.get(k);
        if (!prev || score(link) > score(prev)) m.set(k, link);
      }
    }
    return m;
  }, [simLinks]);

  const filteredFrom = useMemo(() => {
    if (!fromQuery || !fromOpen) return [];
    const q = fromQuery.toLowerCase();
    return endpointNodes
      .filter(
        (n) =>
          n.id !== pathTo?.id && endpointLabel(n).toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [fromQuery, fromOpen, endpointNodes, pathTo?.id, endpointLabel]);

  const filteredTo = useMemo(() => {
    if (!toQuery || !toOpen) return [];
    const q = toQuery.toLowerCase();
    return endpointNodes
      .filter(
        (n) =>
          n.id !== pathFrom?.id && endpointLabel(n).toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [toQuery, toOpen, endpointNodes, pathFrom?.id, endpointLabel]);

  return (
    <div className="w-full">
      <Title description="MP–company–person connections graph">
        {t("connections_title") || "Connections"}
      </Title>

      <ConnectionsHero
        ns={selectedNs}
        onCellClick={(a, b) => setPartyPair([a, b])}
      />

      <FilterRail
        filters={connFilters}
        setNs={setNs}
        setCrossParty={setCrossParty}
        setCurrentOnly={setCurrentOnly}
        setHighConfidenceOnly={setHighConfidenceOnly}
        setPartyPair={setPartyPair}
        resetAll={resetAll}
        availableNsFolders={availableNsFolders}
      />

      <div className="my-4">
        {(diffMode ? diffPairs.merged.length : scopedPairs.length) > 0 && (
          <Card className="my-4">
            <CardContent className="p-3 md:p-4">
              <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
                <h3 className="text-sm font-semibold">
                  {t("connections_top_pairs_title") || "Strongest connections"}
                  <span className="font-normal text-muted-foreground ml-2 text-xs">
                    {selectedNs
                      ? t("connections_top_pairs_subtitle_scoped", {
                          nsLabel: selectedNs,
                        }) ||
                        `MP↔MP ties touching the ${selectedNs}ᵗʰ parliament`
                      : t("connections_top_pairs_subtitle_all") ||
                        "Across all parliaments"}
                  </span>
                </h3>
                <div className="flex items-center gap-2 text-xs">
                  {priorNs && (
                    <button
                      type="button"
                      onClick={() => setDiffMode((v) => !v)}
                      className={
                        diffMode
                          ? "rounded-full border border-primary bg-primary/10 px-2 py-1 text-primary"
                          : "rounded-full border border-border/60 px-2 py-1 text-muted-foreground hover:bg-muted"
                      }
                    >
                      {t("connections_diff_toggle", {
                        nsLabel: selectedNs,
                        priorLabel: priorNs,
                      }) || `Compare ${priorNs} → ${selectedNs}`}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const blob = exportPairsCsv(
                        diffMode ? diffPairs.merged : scopedPairs,
                      );
                      downloadCsv(
                        blob,
                        `connections-${selectedNs ?? "all"}.csv`,
                      );
                    }}
                    className="rounded-full border border-border/60 px-2 py-1 text-muted-foreground hover:bg-muted"
                  >
                    {t("connections_export_csv") || "Export CSV"}
                  </button>
                  <span className="text-muted-foreground tabular-nums">
                    {diffMode ? diffPairs.merged.length : scopedPairs.length}
                  </span>
                </div>
              </div>
              <TopPairsList
                pairs={diffMode ? diffPairs.merged : scopedPairs}
                limit={20}
                diffKindFor={diffMode ? diffPairs.kind : undefined}
              />
            </CardContent>
          </Card>
        )}
      </div>

      <OfficialRankingsCard />

      {/* Orbital graph — rendered as a normal card below the strongest-ties
          and rankings sections so it is always visible. */}
      <Card className="my-4">
        <CardContent className="p-3 md:p-4">
          <h3 className="text-sm font-semibold mb-3">
            {t("connections_tab_graph") || "Explore graph"}
          </h3>
          <div className="flex flex-wrap gap-3 items-center text-xs text-muted-foreground mb-3">
            {(
              [
                {
                  type: "mp",
                  dot: "bg-blue-600",
                  labelKey: "connections_legend_mp",
                  fallback: "MP",
                  count: stats.mp,
                },
                {
                  type: "company",
                  dot: "bg-amber-600",
                  labelKey: "connections_legend_company",
                  fallback: "Company",
                  count: stats.company,
                },
                {
                  type: "person",
                  dot: "bg-neutral-500",
                  labelKey: "connections_legend_person",
                  fallback: "Other person",
                  count: stats.person,
                },
                {
                  type: "official",
                  dot: "bg-teal-600",
                  labelKey: "connections_legend_official",
                  fallback: "Official",
                  count: stats.official,
                },
              ] as const
            ).map((row) => {
              const hidden = hiddenTypes.has(row.type);
              return (
                <button
                  key={row.type}
                  type="button"
                  onClick={() => toggleType(row.type)}
                  aria-pressed={!hidden}
                  className={`-mx-1 inline-flex items-center rounded px-1 hover:bg-muted ${
                    hidden ? "line-through opacity-40" : ""
                  }`}
                >
                  <span
                    className={`mr-1 inline-block h-2 w-2 rounded-full align-middle ${row.dot}`}
                  />
                  {t(row.labelKey) || row.fallback}
                  {": "}
                  {row.count}
                </button>
              );
            })}
            <span>
              {t("connections_legend_edges") || "Edges"}
              {": "}
              {stats.edges}
            </span>
            <span className="ml-auto flex gap-3 flex-wrap">
              <label className="inline-flex gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.hideTransferred}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      hideTransferred: e.target.checked,
                    }))
                  }
                />
                {t("connections_filter_hide_transferred") || "Hide transfers"}
              </label>
              <label className="inline-flex gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.largestComponentOnly}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      largestComponentOnly: e.target.checked,
                    }))
                  }
                />
                {t("connections_filter_largest_component") ||
                  "Largest component only"}
              </label>
              <label className="inline-flex gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clusterByParty}
                  onChange={(e) => setClusterByParty(e.target.checked)}
                />
                {t("connections_cluster_by_party") || "Cluster by party"}
              </label>
            </span>
          </div>

          <div className="flex flex-wrap gap-2 items-center text-xs mb-2">
            <button
              type="button"
              onClick={() => {
                setPathPickMode(true);
                setPathFrom(null);
                setPathTo(null);
                setPathTrail(null);
                setSelected(null);
                setFromQuery("");
                setToQuery("");
              }}
              className={`px-2 py-1 rounded border ${
                pathPickMode || !!pathFrom
                  ? "bg-red-50 border-red-300 dark:bg-red-950/30 dark:border-red-700"
                  : "border-border hover:bg-muted"
              }`}
            >
              {t("connections_find_path") ||
                "Find connection between two people"}
            </button>
            {(pathFrom || pathTo) && (
              <button
                type="button"
                onClick={() => {
                  setPathFrom(null);
                  setPathTo(null);
                  setPathPickMode(false);
                  setPathTrail(null);
                  setSelected(null);
                  setFromQuery("");
                  setToQuery("");
                }}
                className="px-2 py-1 rounded border border-border hover:bg-muted"
              >
                {t("connections_clear_path") || "Clear"}
              </button>
            )}
          </div>
          {(pathPickMode || !!pathFrom) && (
            <div className="flex gap-2 items-start mb-3 text-xs flex-wrap">
              <div className="relative">
                <input
                  ref={fromInputRef}
                  type="text"
                  placeholder={t("connections_pick_first_mp") || "From…"}
                  value={fromQuery}
                  onChange={(e) => {
                    setFromQuery(e.target.value);
                    setFromOpen(true);
                    setPathFrom(null);
                    setPathTo(null);
                    setPathTrail(null);
                  }}
                  onFocus={() => setFromOpen(true)}
                  onBlur={() => setTimeout(() => setFromOpen(false), 150)}
                  className="px-2 py-1 rounded border border-border text-xs w-52 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {fromOpen && filteredFrom.length > 0 && (
                  <div className="absolute top-full left-0 z-20 bg-card border border-border rounded shadow-lg max-h-52 overflow-y-auto w-64 mt-0.5">
                    {filteredFrom.map((n) => {
                      const label = endpointLabel(n);
                      return (
                        <button
                          key={n.id}
                          type="button"
                          className="w-full text-left px-2 py-1.5 hover:bg-muted flex items-center gap-1.5 text-xs"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setPathFrom(n);
                            setFromQuery(label);
                            setFromOpen(false);
                          }}
                        >
                          {n.type === "mp" ? (
                            <MpAvatar
                              mpId={n.mpId}
                              name={label}
                              className="h-4 w-4 shrink-0"
                            />
                          ) : (
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{
                                  backgroundColor: TYPE_COLORS[n.type],
                                }}
                              />
                            </span>
                          )}
                          <span className="truncate">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <span className="py-1 text-muted-foreground">→</span>
              <div className="relative">
                <input
                  ref={toInputRef}
                  type="text"
                  placeholder={t("connections_pick_second_mp") || "To…"}
                  value={toQuery}
                  onChange={(e) => {
                    setToQuery(e.target.value);
                    setToOpen(true);
                    setPathTo(null);
                    setPathTrail(null);
                  }}
                  onFocus={() => setToOpen(true)}
                  onBlur={() => setTimeout(() => setToOpen(false), 150)}
                  className="px-2 py-1 rounded border border-border text-xs w-52 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {toOpen && filteredTo.length > 0 && (
                  <div className="absolute top-full left-0 z-20 bg-card border border-border rounded shadow-lg max-h-52 overflow-y-auto w-64 mt-0.5">
                    {filteredTo.map((n) => {
                      const label = endpointLabel(n);
                      return (
                        <button
                          key={n.id}
                          type="button"
                          className="w-full text-left px-2 py-1.5 hover:bg-muted flex items-center gap-1.5 text-xs"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setPathTo(n);
                            setToQuery(label);
                            setToOpen(false);
                            setPathPickMode(false);
                          }}
                        >
                          {n.type === "mp" ? (
                            <MpAvatar
                              mpId={n.mpId}
                              name={label}
                              className="h-4 w-4 shrink-0"
                            />
                          ) : (
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{
                                  backgroundColor: TYPE_COLORS[n.type],
                                }}
                              />
                            </span>
                          )}
                          <span className="truncate">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          <div ref={canvasWrapRef} className="w-full relative">
            {isLoading || !graph ? (
              <div
                className="text-sm text-muted-foreground"
                style={{ height: size.h }}
              >
                {t("loading") || "Loading…"}
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                onMouseMove={onMouseMove}
                onMouseDown={onMouseDown}
                onMouseUp={onMouseUp}
                onMouseLeave={() => {
                  draggingRef.current = null;
                  lastMouseRef.current = null;
                  hoveredIdRef.current = null;
                  setHovered(null);
                }}
                onWheel={onWheel}
                className="block border rounded select-none"
                style={{
                  width: size.w,
                  height: size.h,
                  touchAction: "none",
                }}
              />
            )}
            {detail && !isLoading && graph && !pathResultVisible && (
              <div
                ref={popoverRef}
                className={`absolute z-10 bg-card/85 backdrop-blur-sm border rounded-md shadow-lg p-3 overflow-y-auto ${
                  selected ? "" : "pointer-events-none"
                }`}
                style={{
                  left: 0,
                  top: 0,
                  maxWidth: Math.min(320, Math.max(220, size.w - 16)),
                  maxHeight: Math.max(
                    160,
                    Math.floor(
                      (visibleVRange.bottom - visibleVRange.top || size.h) *
                        0.6,
                    ),
                  ),
                }}
              >
                <div className="text-sm font-semibold flex items-center gap-2">
                  {(() => {
                    const detailDisplay =
                      detail.type === "mp"
                        ? localizedMpLabel(detail.mpId, detail.label)
                        : detail.label;
                    return (
                      <>
                        {detail.type === "mp" ? (
                          <MpAvatar
                            mpId={detail.mpId}
                            name={detailDisplay}
                            className="h-6 w-6"
                          />
                        ) : (
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{
                              backgroundColor: TYPE_COLORS[detail.type],
                            }}
                          />
                        )}
                        {detail.type === "mp" ? (
                          <Link
                            to={candidateUrlForMp(detail.mpId)}
                            className="hover:underline truncate"
                          >
                            {detailDisplay}
                          </Link>
                        ) : detail.type === "company" && detail.slug ? (
                          <Link
                            to={`/mp/company/${encodeURIComponent(detail.slug)}`}
                            className="hover:underline truncate"
                          >
                            {detailDisplay}
                          </Link>
                        ) : detail.type === "official" ? (
                          <Link
                            to={`/officials/${encodeURIComponent(detail.slug)}`}
                            className="hover:underline truncate"
                          >
                            {detailDisplay}
                          </Link>
                        ) : (
                          <span className="truncate">{detailDisplay}</span>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {detail.type === "mp"
                    ? (t("connections_legend_mp") || "MP") +
                      (detail.partyGroupShort
                        ? ` · ${partyGroupShortLabel(detail.partyGroupShort) ?? detail.partyGroupShort}`
                        : "")
                    : detail.type === "company"
                      ? `${t("connections_legend_company") || "Company"}${
                          detail.legalForm ? ` · ${detail.legalForm}` : ""
                        }${detail.uic ? ` · ${detail.uic}` : ""}`
                      : detail.type === "official"
                        ? `${t("connections_legend_official") || "Official"}${
                            detail.municipality
                              ? ` · ${detail.municipality}`
                              : ""
                          }`
                        : t("connections_legend_person") || "Other person"}
                </div>

                <div className="text-xs text-muted-foreground mt-2">
                  {t("connections_neighbors") || "Connections"}:{" "}
                  {detailNeighbors.length}
                </div>
                <div className="text-xs mt-1 flex flex-col gap-0.5">
                  {detailNeighbors.slice(0, 24).map((n) => {
                    const nDisplay =
                      n.type === "mp"
                        ? localizedMpLabel(n.mpId, n.label)
                        : n.label;
                    return (
                      <div
                        key={n.id}
                        className="truncate flex items-center gap-1.5"
                      >
                        {n.type === "mp" ? (
                          <MpAvatar
                            mpId={n.mpId}
                            name={nDisplay}
                            className="h-4 w-4"
                          />
                        ) : (
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full align-middle shrink-0"
                            style={{
                              backgroundColor: TYPE_COLORS[n.type],
                            }}
                          />
                        )}
                        {n.type === "mp" ? (
                          <Link
                            to={candidateUrlForMp(n.mpId)}
                            className="hover:underline truncate"
                          >
                            {nDisplay}
                          </Link>
                        ) : n.type === "company" && n.slug ? (
                          <Link
                            to={`/mp/company/${encodeURIComponent(n.slug)}`}
                            className="hover:underline truncate"
                          >
                            {nDisplay}
                          </Link>
                        ) : (
                          <span className="truncate">{nDisplay}</span>
                        )}
                      </div>
                    );
                  })}
                  {detailNeighbors.length > 24 && (
                    <div className="text-muted-foreground italic">
                      +{detailNeighbors.length - 24} {t("more") || "more"}…
                    </div>
                  )}
                </div>
              </div>
            )}
            {pathFrom &&
              pathTo &&
              pathNodeIds &&
              pathEdgeKeys &&
              !isLoading &&
              graph && (
                <div
                  className="absolute z-10 bg-card/85 backdrop-blur-sm border rounded-md shadow-lg p-3 overflow-y-auto"
                  style={{
                    top: visibleVRange.top + 8,
                    right: 8,
                    maxWidth: Math.min(300, Math.max(200, size.w - 16)),
                    maxHeight: Math.max(
                      160,
                      Math.floor(
                        (visibleVRange.bottom - visibleVRange.top || size.h) *
                          0.6,
                      ),
                    ),
                  }}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-semibold">
                      {pathEdgeKeys.size === 0
                        ? t("connections_no_path") || "No connection"
                        : `${pathNodeIds.size - 1} ${t("connections_hops") || "hop(s)"}`}
                    </span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground text-base leading-none"
                      onClick={() => {
                        setPathFrom(null);
                        setPathTo(null);
                        setPathPickMode(false);
                        setPathTrail(null);
                        setSelected(null);
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {pathEdgeKeys.size === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {`${pathFrom.type === "mp" ? localizedMpLabel(pathFrom.mpId, pathFrom.label) : pathFrom.label} — ${pathTo.type === "mp" ? localizedMpLabel(pathTo.mpId, pathTo.label) : pathTo.label}`}
                    </p>
                  ) : (
                    <div className="flex flex-col text-xs">
                      {(pathTrail ?? []).map((nodeId, i, trail) => {
                        const node = simNodes.find((n) => n.id === nodeId);
                        if (!node) return null;
                        const label =
                          node.type === "mp"
                            ? localizedMpLabel(node.mpId, node.label)
                            : node.label;
                        const rel =
                          i > 0
                            ? edgeRelationLabel(
                                edgeByPair.get(`${trail[i - 1]}|${nodeId}`),
                              )
                            : null;
                        return (
                          <div key={nodeId}>
                            {i > 0 && (
                              <div className="flex items-center gap-1 pl-2 leading-none py-0.5">
                                <span className="text-muted-foreground">↓</span>
                                {rel && (
                                  <span
                                    title={rel.inferredTitle}
                                    className={`text-[10px] ${
                                      rel.declared
                                        ? "text-blue-600 dark:text-blue-400"
                                        : "text-amber-600 dark:text-amber-500"
                                    } ${
                                      rel.inferred
                                        ? "underline decoration-dotted decoration-from-font underline-offset-2"
                                        : ""
                                    }`}
                                  >
                                    {rel.text}
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5">
                              {node.type === "mp" ? (
                                <MpAvatar
                                  mpId={node.mpId}
                                  name={label}
                                  className="h-4 w-4 shrink-0"
                                />
                              ) : (
                                <span
                                  className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                                  style={{
                                    backgroundColor: TYPE_COLORS[node.type],
                                  }}
                                />
                              )}
                              {node.type === "mp" ? (
                                <Link
                                  to={candidateUrlForMp(node.mpId)}
                                  className="font-medium hover:underline truncate"
                                >
                                  {label}
                                </Link>
                              ) : node.type === "company" && node.slug ? (
                                <Link
                                  to={`/mp/company/${encodeURIComponent(node.slug)}`}
                                  className="text-muted-foreground hover:underline truncate"
                                >
                                  {label}
                                </Link>
                              ) : node.type === "official" ? (
                                <Link
                                  to={`/officials/${encodeURIComponent(node.slug)}`}
                                  className="text-muted-foreground hover:underline truncate"
                                >
                                  {label}
                                </Link>
                              ) : (
                                <span className="text-muted-foreground truncate">
                                  {label}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
