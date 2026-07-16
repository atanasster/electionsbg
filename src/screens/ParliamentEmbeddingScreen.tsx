import { FC, useMemo, useRef, useState } from "react";
import { Link } from "@/ux/Link";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ZAxis,
} from "recharts";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { useMpEmbedding } from "@/data/parliament/votes/useMpEmbedding";
import { useMpProfile } from "@/data/parliament/votes/useMpProfile";
import { useCandidateUrlForVote } from "@/data/parliament/votes/useCandidateUrlForVote";
import { useMps } from "@/data/parliament/useMps";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { cn } from "@/lib/utils";
import { tooltipSurfaceCompactClass } from "@/components/ui/tooltipSurface";

type ScatterPoint = {
  mpId: number;
  x: number;
  y: number;
  name: string;
  partyShort: string | null;
  color: string;
};

const FALLBACK_COLOR = "#94a3b8";

// Tooltip carries the resolved MP name (roster-first, session-fallback) and
// the candidate avatar (photo + party-coloured ring) — same visual language as
// every other MP-row surface in the app.
const Tip: FC<{
  active?: boolean;
  payload?: { payload: ScatterPoint }[];
  labelForPartyShort: (s?: string | null) => string;
}> = ({ active, payload, labelForPartyShort }) => {
  if (!active || !payload?.[0]?.payload) return null;
  const p = payload[0].payload;
  const partyLabel = p.partyShort
    ? labelForPartyShort(p.partyShort) || p.partyShort
    : null;
  return (
    <div className={cn("z-50 overflow-hidden", tooltipSurfaceCompactClass)}>
      <div className="flex items-center gap-2.5 text-xs">
        <MpAvatar mpId={p.mpId} name={p.name} className="h-9 w-9" />
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-medium truncate max-w-[220px]">{p.name}</span>
          {partyLabel && (
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span
                className="inline-block w-2 h-2 rounded-sm shrink-0"
                style={{ backgroundColor: p.color }}
              />
              {partyLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// Initial zoom = data bounds + 5% pad. Buttons shrink/grow `half` around the
// centre and shift `centre` by 20% of the half each step. The domain prop on
// recharts XAxis/YAxis re-renders the chart in place so this stays cheap.
const ZOOM_FACTOR = 0.7;
const PAN_FRACTION = 0.2;

type Viewport = { cx: number; cy: number; halfX: number; halfY: number };

export const ParliamentEmbeddingScreen: FC = () => {
  const { t } = useTranslation();
  const { points, file, computedAt, isLoading } = useMpEmbedding();
  const { findMpById } = useMps();
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();
  const candidateUrl = useCandidateUrlForVote();

  // Resolve MP name + party from the per-NS profile embedded in the rollcall
  // index — tiny (already loaded) compared to fetching a whole session JSON
  // just for name + party lookup. parliament.bg's id recycling across NSes
  // means the deduped roster alone often misses party assignment.
  const { mpParty: sessionParty, mpNames: sessionNames } = useMpProfile();

  const enriched: ScatterPoint[] = useMemo(() => {
    const out: ScatterPoint[] = [];
    for (const p of points) {
      const mp = findMpById(p.mpId);
      const partyShort =
        mp?.currentPartyGroupShort ?? sessionParty[String(p.mpId)] ?? null;
      const color = colorForPartyShort(partyShort) ?? FALLBACK_COLOR;
      out.push({
        mpId: p.mpId,
        x: p.x,
        y: p.y,
        name: mp?.name ?? sessionNames[String(p.mpId)] ?? `MP #${p.mpId}`,
        partyShort,
        color,
      });
    }
    return out;
  }, [points, findMpById, colorForPartyShort, sessionParty, sessionNames]);

  // Group points by party so each series gets its own color in the legend.
  const byParty = useMemo(() => {
    const m = new Map<string, ScatterPoint[]>();
    for (const p of enriched) {
      const key = p.partyShort ?? "—";
      const arr = m.get(key) ?? [];
      arr.push(p);
      m.set(key, arr);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [enriched]);

  const allParties = useMemo(() => byParty.map(([k]) => k), [byParty]);
  const [hiddenParties, setHiddenParties] = useState<Set<string>>(new Set());
  const visibleParties = useMemo(
    () => byParty.filter(([k]) => !hiddenParties.has(k)),
    [byParty, hiddenParties],
  );

  const toggle = (key: string) => {
    setHiddenParties((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Data bounds + initial viewport. Recomputed when the embedding changes.
  const dataBounds = useMemo(() => {
    if (enriched.length === 0) {
      return { xMin: -1, xMax: 1, yMin: -1, yMax: 1 };
    }
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of enriched) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    return { xMin, xMax, yMin, yMax };
  }, [enriched]);

  const initialViewport: Viewport = useMemo(() => {
    const { xMin, xMax, yMin, yMax } = dataBounds;
    return {
      cx: (xMin + xMax) / 2,
      cy: (yMin + yMax) / 2,
      halfX: ((xMax - xMin) / 2) * 1.05,
      halfY: ((yMax - yMin) / 2) * 1.05,
    };
  }, [dataBounds]);

  const [viewport, setViewport] = useState<Viewport | null>(null);
  const v = viewport ?? initialViewport;
  const xDomain: [number, number] = [v.cx - v.halfX, v.cx + v.halfX];
  const yDomain: [number, number] = [v.cy - v.halfY, v.cy + v.halfY];

  const zoom = (factor: number) =>
    setViewport({
      cx: v.cx,
      cy: v.cy,
      halfX: v.halfX * factor,
      halfY: v.halfY * factor,
    });
  const pan = (dx: number, dy: number) =>
    setViewport({
      cx: v.cx + v.halfX * dx,
      cy: v.cy + v.halfY * dy,
      halfX: v.halfX,
      halfY: v.halfY,
    });
  const reset = () => setViewport(null);

  // Cursor-anchored zoom + drag-to-pan. We attach handlers to a div wrapping
  // the recharts SVG and translate pixel deltas into data-coordinate deltas
  // by reading the wrapper's bounding box (axes are hidden so we don't worry
  // about plot-area inset). For zoom we keep the data point under the cursor
  // pinned to the same pixel — that's the convention users expect.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    px: number;
    py: number;
    cx: number;
    cy: number;
    halfX: number;
    halfY: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!wrapperRef.current) return;
    e.preventDefault();
    const rect = wrapperRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // Smooth, magnitude-aware zoom: factor scales exponentially with the
    // wheel delta so a tiny trackpad scroll produces a tiny zoom, while a
    // hard wheel tick still feels responsive. Clamp the per-event delta so
    // a single huge spike (some trackpads do this) can't blow out the view.
    const clamped = Math.max(-200, Math.min(200, e.deltaY));
    const factor = Math.exp(clamped * 0.0025);
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    // Pixel → data, then anchor data point at cursor so it stays put.
    const dataX = v.cx - v.halfX + (px / rect.width) * 2 * v.halfX;
    // recharts Y goes up but pixels go down, so invert:
    const dataY = v.cy + v.halfY - (py / rect.height) * 2 * v.halfY;
    const newHalfX = v.halfX * factor;
    const newHalfY = v.halfY * factor;
    const newCx = dataX * (1 - factor) + v.cx * factor;
    const newCy = dataY * (1 - factor) + v.cy * factor;
    setViewport({ cx: newCx, cy: newCy, halfX: newHalfX, halfY: newHalfY });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragRef.current = {
      px: e.clientX,
      py: e.clientY,
      cx: v.cx,
      cy: v.cy,
      halfX: v.halfX,
      halfY: v.halfY,
    };
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dxPx = e.clientX - d.px;
    const dyPx = e.clientY - d.py;
    // Drag right → viewport shifts left (content follows cursor):
    const newCx = d.cx - (dxPx / rect.width) * 2 * d.halfX;
    // Drag down → viewport shifts down in data terms (Y inverted):
    const newCy = d.cy + (dyPx / rect.height) * 2 * d.halfY;
    setViewport({ cx: newCx, cy: newCy, halfX: d.halfX, halfY: d.halfY });
  };

  const endDrag = () => {
    dragRef.current = null;
    setIsDragging(false);
  };

  const pageTitle = t("embedding_title") || "MP voting space";

  return (
    <>
      <Title description={t("embedding_description") || pageTitle}>
        {pageTitle}
      </Title>
      <GovernanceBreadcrumb
        sectionKey="gov_hub_parliament_title"
        sectionTo="/parliament"
        currentKey="parliament_embedding_title"
        className="mt-5"
      />

      <section aria-label={pageTitle} className="my-4 space-y-6">
        <p className="text-sm text-muted-foreground">
          {t("embedding_intro") ||
            "Each dot is one MP. Distance approximates how differently two MPs vote — neighbours vote the same way most of the time. Layout is a UMAP projection of the full vote-vector space, coloured by parliamentary group. Clusters reveal informal blocs."}
        </p>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">
            {t("loading") || "Loading…"}
          </div>
        ) : enriched.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t("embedding_empty") ||
              "No embedding data has been computed yet — run the derived-metrics step first."}
          </div>
        ) : (
          <>
            <section className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <p className="text-xs text-muted-foreground">
                  {t("embedding_interaction_hint") ||
                    "Drag to pan · scroll to zoom · or use the controls"}
                </p>
                <ChartControls
                  onZoomIn={() => zoom(ZOOM_FACTOR)}
                  onZoomOut={() => zoom(1 / ZOOM_FACTOR)}
                  onReset={reset}
                  onPanLeft={() => pan(-PAN_FRACTION, 0)}
                  onPanRight={() => pan(PAN_FRACTION, 0)}
                  onPanUp={() => pan(0, PAN_FRACTION)}
                  onPanDown={() => pan(0, -PAN_FRACTION)}
                />
              </div>
              <div
                ref={wrapperRef}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={endDrag}
                onMouseLeave={endDrag}
                className={`relative select-none touch-none ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
                style={{ touchAction: "none" }}
              >
                <div className="pointer-events-none absolute left-2 bottom-2 z-10 rounded-md border bg-card/85 backdrop-blur-sm px-2.5 py-1.5 text-[11px] leading-tight max-w-[200px]">
                  <ul className="flex flex-col gap-0.5">
                    {allParties.map((party) => {
                      const pts = byParty.find(([k]) => k === party)?.[1] ?? [];
                      const color = pts[0]?.color ?? FALLBACK_COLOR;
                      const visible = !hiddenParties.has(party);
                      return (
                        <li
                          key={party}
                          className={`flex items-center gap-1.5 ${visible ? "" : "opacity-35"}`}
                        >
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="truncate font-medium">
                            {labelForPartyShort(party) || party}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <ResponsiveContainer width="100%" height={520}>
                  <ScatterChart
                    margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="x"
                      domain={xDomain}
                      allowDataOverflow
                      tick={false}
                      axisLine={false}
                      label={undefined}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="y"
                      domain={yDomain}
                      allowDataOverflow
                      tick={false}
                      axisLine={false}
                    />
                    <ZAxis range={[40, 40]} />
                    <Tooltip
                      content={<Tip labelForPartyShort={labelForPartyShort} />}
                      cursor={{ strokeDasharray: "3 3" }}
                    />
                    {visibleParties.map(([party, pts]) => (
                      <Scatter
                        key={party}
                        name={party}
                        data={pts}
                        fill={pts[0]?.color ?? FALLBACK_COLOR}
                        fillOpacity={0.85}
                      />
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {allParties.map((party) => {
                  const pts = byParty.find(([k]) => k === party)?.[1] ?? [];
                  const color = pts[0]?.color ?? FALLBACK_COLOR;
                  const active = !hiddenParties.has(party);
                  return (
                    <button
                      key={party}
                      type="button"
                      onClick={() => toggle(party)}
                      className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                        active ? "text-white" : "text-muted-foreground"
                      }`}
                      style={
                        active
                          ? { backgroundColor: color, borderColor: color }
                          : { borderColor: color }
                      }
                    >
                      {labelForPartyShort(party) || party}
                      <span className="opacity-70 ml-1">({pts.length})</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border bg-card p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide mb-2">
                {t("embedding_outliers") || "Bridge MPs"}
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                {t("embedding_outliers_hint") ||
                  "MPs whose nearest neighbours are mostly from a different parliamentary group — the most plausible candidates for cross-party voting."}
              </p>
              <BridgeList
                points={enriched}
                labelForPartyShort={labelForPartyShort}
                candidateUrl={candidateUrl}
              />
            </section>

            {file && (
              <p className="text-xs text-muted-foreground">
                {t("cohesion_computed_at") || "Computed"}:{" "}
                <span className="tabular-nums">
                  {computedAt?.slice(0, 10) ?? "?"}
                </span>{" "}
                · {file.nMps} {t("embedding_mps") || "MPs"} · {file.nFeatures}{" "}
                {t("embedding_features") || "features"}
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
};

const ChartControls: FC<{
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onPanLeft: () => void;
  onPanRight: () => void;
  onPanUp: () => void;
  onPanDown: () => void;
}> = ({
  onZoomIn,
  onZoomOut,
  onReset,
  onPanLeft,
  onPanRight,
  onPanUp,
  onPanDown,
}) => {
  const { t } = useTranslation();
  const btn =
    "rounded border p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors";
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onPanLeft}
        aria-label={t("embedding_pan_left") || "Pan left"}
        title={t("embedding_pan_left") || "Pan left"}
        className={btn}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onPanDown}
        aria-label={t("embedding_pan_down") || "Pan down"}
        title={t("embedding_pan_down") || "Pan down"}
        className={btn}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onPanUp}
        aria-label={t("embedding_pan_up") || "Pan up"}
        title={t("embedding_pan_up") || "Pan up"}
        className={btn}
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onPanRight}
        aria-label={t("embedding_pan_right") || "Pan right"}
        title={t("embedding_pan_right") || "Pan right"}
        className={btn}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      <span className="mx-1 h-4 w-px bg-border" />
      <button
        type="button"
        onClick={onZoomOut}
        aria-label={t("embedding_zoom_out") || "Zoom out"}
        title={t("embedding_zoom_out") || "Zoom out"}
        className={btn}
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        aria-label={t("embedding_zoom_in") || "Zoom in"}
        title={t("embedding_zoom_in") || "Zoom in"}
        className={btn}
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onReset}
        aria-label={t("embedding_zoom_reset") || "Reset view"}
        title={t("embedding_zoom_reset") || "Reset view"}
        className={btn}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

// Find MPs whose K-nearest-neighbours in the embedding contain a majority
// from a different parliamentary group. Cheap O(n²) since n ≤ ~250.
const BridgeList: FC<{
  points: ScatterPoint[];
  labelForPartyShort: (s?: string | null) => string;
  candidateUrl: (csvMpId: number, sessionName?: string | null) => string;
}> = ({ points, labelForPartyShort, candidateUrl }) => {
  const { t } = useTranslation();
  const K = 5;
  const bridges = useMemo(() => {
    if (points.length === 0) return [];
    const results: Array<{
      mp: ScatterPoint;
      foreignCount: number;
      neighborParties: string[];
    }> = [];
    for (const a of points) {
      if (!a.partyShort) continue;
      const dists = points
        .filter((b) => b.mpId !== a.mpId)
        .map((b) => ({
          mp: b,
          d: Math.hypot(a.x - b.x, a.y - b.y),
        }))
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
    return results.sort((x, y) => y.foreignCount - x.foreignCount).slice(0, 15);
  }, [points]);

  if (bridges.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("embedding_outliers_empty") ||
          "Every MP's nearest neighbours stay within their own group."}
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {bridges.map((b) => (
        <li key={b.mp.mpId}>
          <Link
            to={candidateUrl(b.mp.mpId, b.mp.name)}
            underline={false}
            className="flex items-center gap-3 py-2 hover:bg-muted/40 transition-colors px-2 -mx-2 rounded"
          >
            <MpAvatar mpId={b.mp.mpId} name={b.mp.name} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{b.mp.name}</div>
              <div className="text-xs text-muted-foreground truncate">
                {labelForPartyShort(b.mp.partyShort) || b.mp.partyShort} ·{" "}
                {t("embedding_neighbors_near") || "neighbours from"}:{" "}
                {b.neighborParties
                  .map((p) => labelForPartyShort(p) || p)
                  .join(", ")}
              </div>
            </div>
            <div className="text-xs tabular-nums text-muted-foreground shrink-0">
              {b.foreignCount}/{K}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
};
