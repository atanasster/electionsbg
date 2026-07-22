// Reusable point map for regional/city sector dashboards (courts, МВР, …). One
// marker per CITY: the badge shows a summed count (e.g. total judges), coloured by
// the busiest constituent (its band), so overloaded places stay visible. A city with
// several units opens a paginating card — page through each unit, busiest first —
// reusing the polling-section marker/tooltip look. Places with a single unit get a
// plain hover card.
//
// Generic: the caller supplies points (value ranks within a city + colours the
// marker; badge feeds the summed number; title/subtitle/detail render the card) and
// keeps its own controls/legend/caption around the map.

import {
  FC,
  Fragment,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  CircleMarker,
  Polyline,
  Tooltip,
  useMap,
} from "react-leaflet";
import {
  divIcon,
  DomEvent,
  type LatLngBoundsExpression,
  type Map as LeafletMap,
  type Marker as LeafletMarker,
  type TooltipEvent,
} from "leaflet";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FitBounds } from "./FitBounds";
import {
  DOT_RADIUS,
  groupByLoc,
  shouldSpread,
  spreadRadius,
} from "./sectorPointGrouping";

// Leaflet's stylesheet is loaded dynamically so it lands in its own chunk; see
// LeafletMap.tsx for the rationale.
import("leaflet/dist/leaflet.css");

export interface SectorMapPoint {
  id: string;
  /** [lng, lat] — matches settlements.json `loc`. */
  loc: [number, number];
  /** Ranks units within a city (busiest first) and picks the marker's colour. */
  value: number;
  /** This unit's band colour. */
  color: string;
  /** This unit's contribution to the marker's summed number (e.g. its judges). */
  badge: number;
  /** Card heading (bold). */
  title: string;
  /** Muted second line. */
  subtitle?: string;
  /** Extra card content (e.g. the metric line). */
  detail?: ReactNode;
  /** Optional navigation target on click / the card's "view" button. */
  href?: string;
}

/** A line drawn between two points — e.g. a funded rail section between two towns. */
export interface SectorMapLine {
  id: string;
  /** [lng, lat] endpoints (matches settlements.json `loc`). */
  a: [number, number];
  b: [number, number];
  color: string;
  /** Stroke width in px (default 4). */
  weight?: number;
  /** Hover-card heading (bold). */
  title: string;
  subtitle?: string;
  detail?: ReactNode;
  href?: string;
}

const BG_BOUNDS: LatLngBoundsExpression = [
  [41.2, 22.3],
  [44.3, 28.7],
];

// Stable empty default for `lines`, so re-renders (e.g. the zoom watcher below)
// don't churn the `bounds` memo and make FitBounds re-fit — which would snap the
// map back to the fitted view every time the user zooms.
const NO_LINES: SectorMapLine[] = [];

// A mixed-value cluster shouldn't imply a single band, so in dotMode its count
// badge is drawn neutral (slate-500) rather than the busiest member's colour.
const NEUTRAL_BADGE = "#64748b";

type TipDir = "top" | "bottom" | "left" | "right";

// Open a marker's tooltip into whichever side best fits the card, then clamp the
// card box inside the map so an edge marker never clips. Adapted from SectionsMap —
// Leaflet tooltips never auto-pan, so this never scrolls the map.
const placeTooltip = (
  map: LeafletMap,
  marker: LeafletMarker,
  cardSize: { current: { w: number; h: number } },
  setDirection: (d: TipDir) => void,
) => {
  const tt = marker.getTooltip();
  if (!tt) return;
  const pt = map.latLngToContainerPoint(marker.getLatLng());
  const size = map.getSize();
  const { w: cw, h: ch } = cardSize.current;
  const candidates: { d: TipDir; ratio: number }[] = [
    { d: "bottom", ratio: (size.y - pt.y) / ch },
    { d: "top", ratio: pt.y / ch },
    { d: "right", ratio: (size.x - pt.x) / cw },
    { d: "left", ratio: pt.x / cw },
  ];
  const best = candidates.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  tt.options.direction = best.d;
  tt.options.offset = [0, 0];
  setDirection(best.d);
  if (marker.isTooltipOpen()) tt.update();
  else marker.openTooltip();

  const dir = best.d;
  const nudge = (attempt: number) => {
    const el = tt.getElement();
    if ((!el || el.offsetWidth < 120 || !el.offsetHeight) && attempt < 20) {
      requestAnimationFrame(() => nudge(attempt + 1));
      return;
    }
    if (!el) return;
    const w = el.offsetWidth || cardSize.current.w;
    const h = el.offsetHeight || cardSize.current.h;
    if (el.offsetWidth && el.offsetHeight) cardSize.current = { w, h };
    const p = map.latLngToContainerPoint(marker.getLatLng());
    const s = map.getSize();
    let left = p.x - w / 2;
    let top = p.y - h / 2;
    if (dir === "top") top = p.y - h;
    else if (dir === "bottom") top = p.y;
    else if (dir === "right") left = p.x;
    else if (dir === "left") left = p.x - w;
    const margin = 6;
    let ox = 0;
    let oy = 0;
    if (left < margin) ox = margin - left;
    else if (left + w > s.x - margin) ox = s.x - margin - (left + w);
    if (top < margin) oy = margin - top;
    else if (top + h > s.y - margin) oy = s.y - margin - (top + h);
    tt.options.offset = [ox, oy];
    tt.update();
  };
  requestAnimationFrame(() => nudge(0));
};

const badgeIcon = (total: number, color: string) => {
  const label = String(total);
  const w = 16 + label.length * 7;
  return divIcon({
    className: "sector-point-icon",
    html: `<span style="background:${color}">${label}</span>`,
    iconSize: [w, 22],
    iconAnchor: [w / 2, 11],
  });
};

const PointCard: FC<{ p: SectorMapPoint }> = ({ p }) => (
  <div className="text-left" style={{ minWidth: 160 }}>
    <div className="pb-0.5 text-sm font-semibold">{p.title}</div>
    {p.subtitle && <div className="pb-1 text-xs opacity-80">{p.subtitle}</div>}
    {p.detail && <div className="text-xs">{p.detail}</div>}
  </div>
);

// One unit in a city — a colored badge with a hover card.
const SingleMarker: FC<{ p: SectorMapPoint; center: [number, number] }> = ({
  p,
  center,
}) => {
  const map = useMap();
  const navigate = useNavigate();
  const markerRef = useRef<LeafletMarker | null>(null);
  const cardSize = useRef({ w: 220, h: 110 });
  const [direction, setDirection] = useState<TipDir>("bottom");
  const icon = useMemo(() => badgeIcon(p.badge, p.color), [p.badge, p.color]);

  return (
    <Marker
      ref={markerRef}
      position={center}
      icon={icon}
      eventHandlers={{
        mouseover: () => {
          if (markerRef.current)
            placeTooltip(map, markerRef.current, cardSize, setDirection);
        },
        click: () => {
          if (p.href) navigate(p.href);
        },
      }}
    >
      <Tooltip direction={direction} className="sector-tooltip">
        <PointCard p={p} />
      </Tooltip>
    </Marker>
  );
};

// dotMode: a value-coloured dot with a plain hover card (no numbered badge). Used
// for a lone unit and for each member of a spiderfied group. A CircleMarker so
// thousands stay cheap on the canvas renderer.
const DotMarker: FC<{ p: SectorMapPoint; center: [number, number] }> = ({
  p,
  center,
}) => {
  const navigate = useNavigate();
  return (
    <CircleMarker
      center={center}
      radius={DOT_RADIUS}
      pathOptions={{
        color: p.color,
        fillColor: p.color,
        fillOpacity: 0.8,
        weight: 1,
      }}
      eventHandlers={{ click: () => p.href && navigate(p.href) }}
    >
      <Tooltip direction="auto" offset={[0, -4]} className="sector-tooltip">
        <PointCard p={p} />
      </Tooltip>
    </CircleMarker>
  );
};

// Spiderfy: at high zoom a co-located group fans out onto a small pixel ring so
// each unit gets its own colour-coded dot, with a thin leg back to the shared
// centroid. Pixel offsets are recomputed each render (the parent re-renders on
// zoomend), so the ring keeps its on-screen size as you zoom.
const SpreadGroup: FC<{
  group: SectorMapPoint[];
  center: [number, number];
}> = ({ group, center }) => {
  const map = useMap();
  const base = map.latLngToLayerPoint(center);
  const n = group.length;
  const radius = spreadRadius(n);
  return (
    <>
      {group.map((p, i) => {
        const angle = (2 * Math.PI * i) / n - Math.PI / 2;
        const ll = map.layerPointToLatLng(
          base.add([radius * Math.cos(angle), radius * Math.sin(angle)]),
        );
        const spot: [number, number] = [ll.lat, ll.lng];
        return (
          <Fragment key={p.id}>
            <Polyline
              positions={[center, spot]}
              pathOptions={{ color: p.color, weight: 1, opacity: 0.4 }}
              interactive={false}
            />
            <DotMarker p={p} center={spot} />
          </Fragment>
        );
      })}
    </>
  );
};

// Lifts the live zoom into React state so the parent can decide, per group,
// whether to collapse into a count badge or spiderfy into individual dots. Only
// mounted when spreadZoom is set, so plain sector maps pay nothing for it.
const ZoomWatcher: FC<{ onZoom: (z: number) => void }> = ({ onZoom }) => {
  const map = useMap();
  useEffect(() => {
    onZoom(map.getZoom());
    const handler = () => onZoom(map.getZoom());
    map.on("zoomend", handler);
    return () => {
      map.off("zoomend", handler);
    };
  }, [map, onZoom]);
  return null;
};

// Several units sharing a city: the badge sums their `badge` and takes the busiest
// unit's colour (or a neutral badge in dotMode); the interactive card pages through
// them (busiest first).
const ClusterMarker: FC<{
  group: SectorMapPoint[];
  center: [number, number];
  groupNoun: string;
  badgeNoun: string;
  openLabel?: string;
  badgeColor?: string;
}> = ({ group, center, groupNoun, badgeNoun, openLabel, badgeColor }) => {
  const map = useMap();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const markerRef = useRef<LeafletMarker | null>(null);
  const cardSize = useRef({ w: 240, h: 170 });
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [direction, setDirection] = useState<TipDir>("bottom");
  const [index, setIndex] = useState(0);

  const total = useMemo(() => group.reduce((s, p) => s + p.badge, 0), [group]);
  const icon = useMemo(
    // group[0] is the busiest (max value); dotMode overrides with a neutral badge.
    () => badgeIcon(total, badgeColor ?? group[0].color),
    [total, group, badgeColor],
  );
  const current = group[Math.min(index, group.length - 1)];

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(
      () => markerRef.current?.closeTooltip(),
      250,
    );
  }, [cancelClose]);
  const placeAndOpen = useCallback(() => {
    if (markerRef.current)
      placeTooltip(map, markerRef.current, cardSize, setDirection);
  }, [map]);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    marker.off("mouseout", marker.closeTooltip, marker);
    const onOpen = (e: TooltipEvent) => {
      if (e.tooltip !== marker.getTooltip()) return;
      const el = e.tooltip.getElement();
      if (!el) return;
      DomEvent.disableClickPropagation(el);
      el.addEventListener("mouseenter", cancelClose);
      el.addEventListener("mouseleave", scheduleClose);
    };
    const onClose = (e: TooltipEvent) => {
      const el = e.tooltip.getElement();
      el?.removeEventListener("mouseenter", cancelClose);
      el?.removeEventListener("mouseleave", scheduleClose);
    };
    const onMapClick = () => marker.closeTooltip();
    map.on("tooltipopen", onOpen);
    map.on("tooltipclose", onClose);
    map.on("click", onMapClick);
    return () => {
      map.off("tooltipopen", onOpen);
      map.off("tooltipclose", onClose);
      map.off("click", onMapClick);
      cancelClose();
    };
  }, [map, cancelClose, scheduleClose]);

  return (
    <Marker
      ref={markerRef}
      position={center}
      icon={icon}
      eventHandlers={{
        mouseover: () => {
          cancelClose();
          placeAndOpen();
        },
        mouseout: scheduleClose,
        click: () => {
          cancelClose();
          placeAndOpen();
        },
      }}
    >
      <Tooltip
        interactive
        direction={direction}
        className="sector-tooltip section-pager-tip"
      >
        <div className="text-left" style={{ minWidth: 190 }}>
          <div className="flex items-center justify-between gap-2 pb-1">
            <button
              type="button"
              aria-label={t("previous") || "Previous"}
              className="rounded p-0.5 hover:bg-foreground/10"
              onClick={() =>
                setIndex((i) => (i - 1 + group.length) % group.length)
              }
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="whitespace-nowrap text-[10px] uppercase tracking-wide opacity-70">
              {group.length} {groupNoun}
              {/* Only append the summed badge when it is a DISTINCT second metric
                  (e.g. judges). A pure count map (badge = 1 each) leaves badgeNoun
                  empty, so the total equals group.length and is not repeated. */}
              {badgeNoun ? ` · ${total} ${badgeNoun}` : ""}
            </span>
            <button
              type="button"
              aria-label={t("next") || "Next"}
              className="rounded p-0.5 hover:bg-foreground/10"
              onClick={() => setIndex((i) => (i + 1) % group.length)}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <PointCard p={current} />
          {current.href && (
            <button
              type="button"
              className="mt-1.5 w-full rounded bg-foreground/10 py-1 text-[11px] font-semibold hover:bg-foreground/20"
              onClick={() => current.href && navigate(current.href)}
            >
              {openLabel || t("view_section") || "Open"} →
            </button>
          )}
        </div>
      </Tooltip>
    </Marker>
  );
};

// A funded rail section — a coloured line between two towns with a hover card and an
// optional click-through. A slightly wider invisible line sits under it as a fat hit target.
const LineSegment: FC<{ line: SectorMapLine }> = ({ line }) => {
  const navigate = useNavigate();
  const positions: [number, number][] = [
    [line.a[1], line.a[0]],
    [line.b[1], line.b[0]],
  ];
  const weight = line.weight ?? 4;
  return (
    <Polyline
      positions={positions}
      pathOptions={{ color: line.color, weight, opacity: 0.85 }}
      eventHandlers={{
        click: () => {
          if (line.href) navigate(line.href);
        },
      }}
    >
      <Tooltip sticky className="sector-tooltip" direction="top">
        <PointCard
          p={{
            id: line.id,
            loc: line.a,
            value: 0,
            color: line.color,
            badge: 0,
            title: line.title,
            subtitle: line.subtitle,
            detail: line.detail,
          }}
        />
      </Tooltip>
    </Polyline>
  );
};

export const SectorPointMap: FC<{
  points: SectorMapPoint[];
  /** Optional lines drawn under the markers (e.g. funded rail sections). */
  lines?: SectorMapLine[];
  /** Plural noun for the unit count in a city's pager header, e.g. "съдилища". */
  groupNoun?: string;
  /** Noun for the summed badge total in the pager header, e.g. "съдии". Omit when
   *  the badge simply counts the units themselves (then the pager shows only the
   *  unit count, not a repeated "· N units"). */
  badgeNoun?: string;
  /** Label for the popup's navigate button (defaults to the polling-section
   *  wording). Pass a domain noun, e.g. "Виж болницата". */
  openLabel?: string;
  height?: number;
  /** Draw each point as a value-coloured dot (its `color`) instead of a numbered
   *  badge; co-located points still collapse into a neutral count badge + pager. */
  dotMode?: boolean;
  /** Zoom at/above which a co-located group fans out into individual dots
   *  (spiderfy). Omit to never spread — the group stays one badge at every zoom. */
  spreadZoom?: number;
  /** Only groups up to this size spiderfy; larger stacks stay a pager badge
   *  (e.g. София's whole-city aggregate). Default 12. */
  spreadMax?: number;
  /** Render circle markers on a canvas (cheaper for thousands of dots). */
  preferCanvas?: boolean;
}> = ({
  points,
  lines = NO_LINES,
  groupNoun = "",
  badgeNoun = "",
  openLabel,
  height = 460,
  dotMode = false,
  spreadZoom,
  spreadMax = 12,
  preferCanvas = false,
}) => {
  const [zoom, setZoom] = useState<number | null>(null);
  // One marker per city (shared settlement centroid), busiest-first within each.
  const groups = useMemo(() => groupByLoc(points), [points]);

  const bounds = useMemo<LatLngBoundsExpression>(() => {
    const coords: [number, number][] = [
      ...points.map((p) => p.loc),
      ...lines.flatMap((l) => [l.a, l.b]),
    ];
    if (!coords.length) return BG_BOUNDS;
    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity;
    for (const [lng, lat] of coords) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
    if (minLat === maxLat && minLng === maxLng) return BG_BOUNDS;
    return [
      [minLat, minLng],
      [maxLat, maxLng],
    ];
  }, [points, lines]);

  return (
    <div
      className="w-full overflow-hidden rounded-xl border"
      style={{ height }}
    >
      <MapContainer
        className="h-full w-full"
        bounds={bounds}
        boundsOptions={{ padding: [24, 24] }}
        scrollWheelZoom
        preferCanvas={preferCanvas}
      >
        <FitBounds bounds={bounds} />
        {spreadZoom != null && <ZoomWatcher onZoom={setZoom} />}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {/* Lines under the markers so town badges stay on top. */}
        {lines.map((line) => (
          <LineSegment key={line.id} line={line} />
        ))}
        {groups.map((group) => {
          const [lng, lat] = group[0].loc;
          const center: [number, number] = [lat, lng];
          const spread = shouldSpread({
            len: group.length,
            zoom,
            spreadZoom,
            spreadMax,
          });
          if (spread)
            return (
              <SpreadGroup key={group[0].id} group={group} center={center} />
            );
          if (group.length === 1)
            return dotMode ? (
              <DotMarker key={group[0].id} p={group[0]} center={center} />
            ) : (
              <SingleMarker key={group[0].id} p={group[0]} center={center} />
            );
          return (
            <ClusterMarker
              key={group[0].id}
              group={group}
              center={center}
              groupNoun={groupNoun}
              badgeNoun={badgeNoun}
              openLabel={openLabel}
              badgeColor={dotMode ? NEUTRAL_BADGE : undefined}
            />
          );
        })}
      </MapContainer>
    </div>
  );
};
