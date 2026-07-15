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

const BG_BOUNDS: LatLngBoundsExpression = [
  [41.2, 22.3],
  [44.3, 28.7],
];

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

// Several units sharing a city: the badge sums their `badge` and takes the busiest
// unit's colour; the interactive card pages through them (busiest first).
const ClusterMarker: FC<{
  group: SectorMapPoint[];
  center: [number, number];
  groupNoun: string;
  badgeNoun: string;
}> = ({ group, center, groupNoun, badgeNoun }) => {
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
    () => badgeIcon(total, group[0].color), // group[0] is the busiest (max value)
    [total, group],
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
              {group.length} {groupNoun} · {total} {badgeNoun}
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
              {t("view_section") || "Open"} →
            </button>
          )}
        </div>
      </Tooltip>
    </Marker>
  );
};

const FitPoints: FC<{ bounds: LatLngBoundsExpression }> = ({ bounds }) => {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    let done = false;
    const fit = () => {
      if (done || el.clientHeight <= 0 || el.clientWidth <= 0) return;
      done = true;
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [24, 24] });
      ro.disconnect();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [map, bounds]);
  return null;
};

export const SectorPointMap: FC<{
  points: SectorMapPoint[];
  /** Plural noun for the unit count in a city's pager header, e.g. "съдилища". */
  groupNoun?: string;
  /** Noun for the summed badge total in the pager header, e.g. "съдии". */
  badgeNoun?: string;
  height?: number;
}> = ({ points, groupNoun = "", badgeNoun = "", height = 460 }) => {
  // One marker per city (shared settlement centroid). Each group is sorted busiest
  // first, so group[0] is both the pager's first page and the marker's colour.
  const groups = useMemo(() => {
    const byLoc = new Map<string, SectorMapPoint[]>();
    for (const p of points) {
      const key = `${p.loc[0]},${p.loc[1]}`;
      (byLoc.get(key) ?? byLoc.set(key, []).get(key)!).push(p);
    }
    return [...byLoc.values()]
      .map((g) => g.slice().sort((a, b) => b.value - a.value))
      .sort((a, b) => a[0].value - b[0].value); // busiest cities drawn last
  }, [points]);

  const bounds = useMemo<LatLngBoundsExpression>(() => {
    if (!points.length) return BG_BOUNDS;
    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity;
    for (const p of points) {
      const [lng, lat] = p.loc;
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
  }, [points]);

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
      >
        <FitPoints bounds={bounds} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {groups.map((group) => {
          const [lng, lat] = group[0].loc;
          const center: [number, number] = [lat, lng];
          return group.length === 1 ? (
            <SingleMarker key={group[0].id} p={group[0]} center={center} />
          ) : (
            <ClusterMarker
              key={group[0].id}
              group={group}
              center={center}
              groupNoun={groupNoun}
              badgeNoun={badgeNoun}
            />
          );
        })}
      </MapContainer>
    </div>
  );
};
