import { FC, useMemo, useState, useRef, useEffect, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Marker,
  Tooltip,
  useMap,
} from "react-leaflet";
import {
  LatLngBoundsExpression,
  divIcon,
  DomEvent,
  type DivIcon,
  type Map as LeafletMap,
  type Marker as LeafletMarker,
  type CircleMarker as LeafletCircleMarker,
  type TooltipEvent,
} from "leaflet";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Dynamic import keeps leaflet's CSS out of the render-blocking entry HTML;
// see LeafletMap.tsx for the rationale.
import("leaflet/dist/leaflet.css");
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { SectionInfo, Votes } from "@/data/dataTypes";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useTranslation } from "react-i18next";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { PartyVotesXS } from "../PartyVotesXS";

// Sum the party votes across every section sharing a location, so a shared
// marker can be coloured by the combined winner.
const mergeVotes = (group: SectionInfo[]): Votes[] => {
  const acc = new Map<number, number>();
  group.forEach((s) =>
    s.results.votes.forEach((v) =>
      acc.set(v.partyNum, (acc.get(v.partyNum) || 0) + v.totalVotes),
    ),
  );
  return [...acc.entries()].map(([partyNum, totalVotes]) => ({
    partyNum,
    totalVotes,
  }));
};

// The card body shared by the hover tooltip and the paginated popup.
const SectionCard: FC<{ section: SectionInfo; badge?: string }> = ({
  section,
  badge,
}) => (
  <div className="text-left">
    {badge && (
      <div className="text-xs text-center font-semibold text-negative pb-1">
        ⚠ {badge}
      </div>
    )}
    <div className="text-sm text-center font-semibold pb-1">
      {section.section}
    </div>
    {section.address && (
      <div className="text-xs text-center pb-1 opacity-90 line-clamp-3">
        {section.address}
      </div>
    )}
    <PartyVotesXS votes={section.results.votes} limit={4} />
  </div>
);

// Interactive popup body for a location shared by several polling sections:
// page through them with the chevrons and open any one's full page.
const SectionsPager: FC<{ sections: SectionInfo[]; badge?: string }> = ({
  sections,
  badge,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigateParams();
  const [index, setIndex] = useState(0);
  const n = sections.length;
  const current = sections[Math.min(index, n - 1)];
  return (
    <div className="text-left" style={{ minWidth: 190 }}>
      <div className="flex items-center justify-between gap-2 pb-1">
        <button
          type="button"
          aria-label={t("previous")}
          className="rounded p-0.5 hover:bg-foreground/10"
          onClick={() => setIndex((i) => (i - 1 + n) % n)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-[10px] uppercase tracking-wide opacity-70">
          {index + 1} / {n} {t("sections")}
        </span>
        <button
          type="button"
          aria-label={t("next")}
          className="rounded p-0.5 hover:bg-foreground/10"
          onClick={() => setIndex((i) => (i + 1) % n)}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <SectionCard section={current} badge={badge} />
      <button
        type="button"
        className="mt-1.5 w-full rounded bg-foreground/10 py-1 text-[11px] font-semibold hover:bg-foreground/20"
        onClick={() => navigate({ pathname: `/section/${current.section}` })}
      >
        {t("view_section")} →
      </button>
    </div>
  );
};

type TipDir = "top" | "bottom" | "left" | "right";

// Position a marker's hover tooltip from its *live* on-screen position (not the
// initial fit, since the map pans/zooms): (1) open it into whichever side best
// fits the card relative to its size on that axis, then (2) clamp the whole card
// box inside the map on both axes so a marker near an edge/corner never gets cut
// off. Leaflet tooltips never auto-pan, so none of this scrolls the map.
const placeTooltip = (
  map: LeafletMap,
  marker: LeafletCircleMarker | LeafletMarker,
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

  // Measure the rendered card and clamp it inside the map. Its React content
  // isn't laid out synchronously — and on the very first open the element can
  // need a few frames to attach — so retry until it's actually rendered.
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
    // Leaflet's natural top-left for the card in this direction (offset 0).
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

// A single polling section: a coloured dot with a hover tooltip (placed
// dynamically so it never clips) that navigates to the section page on click.
const SingleSectionMarker: FC<{
  section: SectionInfo;
  position: [number, number];
  fillColor: string;
  strokeColor: string;
  isProblem: boolean;
  badge?: string;
}> = ({ section, position, fillColor, strokeColor, isProblem, badge }) => {
  const map = useMap();
  const navigate = useNavigateParams();
  const markerRef = useRef<LeafletCircleMarker | null>(null);
  const cardSize = useRef({ w: 200, h: 180 });
  const [direction, setDirection] = useState<TipDir>("bottom");

  return (
    <CircleMarker
      ref={markerRef}
      center={position}
      radius={isProblem ? 8 : 6}
      pathOptions={{
        color: strokeColor,
        fillColor,
        fillOpacity: 0.7,
        weight: isProblem ? 3 : 1,
      }}
      eventHandlers={{
        click: () => navigate({ pathname: `/section/${section.section}` }),
        mouseover: () => {
          if (markerRef.current)
            placeTooltip(map, markerRef.current, cardSize, setDirection);
        },
      }}
    >
      <Tooltip direction={direction} className="section-tooltip">
        <SectionCard section={section} badge={badge} />
      </Tooltip>
    </CircleMarker>
  );
};

// A marker shared by several polling sections. The paginated card opens on
// hover (and on click/tap for touch) and stays open while the cursor is over
// either the badge or the card so the chevrons remain reachable.
const SharedLocationMarker: FC<{
  group: SectionInfo[];
  position: [number, number];
  icon: DivIcon;
  badge?: string;
}> = ({ group, position, icon, badge }) => {
  const map = useMap();
  const markerRef = useRef<LeafletMarker | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [direction, setDirection] = useState<TipDir>("bottom");
  // Card dimensions, seeded with an estimate and refined from the real element
  // once it has been measured — used to choose a direction and nudge it in view.
  const cardSize = useRef({ w: 220, h: 240 });

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  }, []);
  // Grace period so the cursor can travel from the badge to the card (and back)
  // without it closing underneath.
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
    // Take over closing from Leaflet, which otherwise closes the tooltip the
    // instant the cursor leaves the badge — making the chevrons unreachable. We
    // close it ourselves, after a grace period, once the cursor has left both
    // the badge and the card.
    marker.off("mouseout", marker.closeTooltip, marker);

    const onOpen = (e: TooltipEvent) => {
      if (e.tooltip !== marker.getTooltip()) return;
      const el = e.tooltip.getElement();
      if (!el) return;
      // Clicks on the chevrons / button must not reach the map (which would
      // dismiss the card via the map-click handler below).
      DomEvent.disableClickPropagation(el);
      el.addEventListener("mouseenter", cancelClose);
      el.addEventListener("mouseleave", scheduleClose);
    };
    const onClose = (e: TooltipEvent) => {
      const el = e.tooltip.getElement();
      el?.removeEventListener("mouseenter", cancelClose);
      el?.removeEventListener("mouseleave", scheduleClose);
    };
    const onMapClick = () => marker.closeTooltip(); // tap elsewhere dismisses
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
      position={position}
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
        }, // touch/tap
      }}
    >
      <Tooltip
        interactive
        direction={direction}
        className="section-tooltip section-pager-tip"
      >
        <SectionsPager sections={group} badge={badge} />
      </Tooltip>
    </Marker>
  );
};

export const SectionsMap: FC<{
  sections: SectionInfo[];
  size: MapCoordinates;
  markerVariant?: "default" | "problem";
  tooltipBadge?: string;
}> = ({ sections, size, markerVariant = "default", tooltipBadge }) => {
  const { t } = useTranslation();
  const { topVotesParty } = usePartyInfo();

  const points = useMemo(
    () =>
      sections.filter(
        (s) =>
          typeof s.longitude === "number" && typeof s.latitude === "number",
      ),
    [sections],
  );

  // Several polling sections frequently share one building (and one geocode),
  // so they would render as a single, indistinguishable marker. Collapse those
  // onto one marker per location and page through them in the popup instead.
  const groups = useMemo(() => {
    const byLocation = new Map<string, SectionInfo[]>();
    points.forEach((s) => {
      const key = `${(s.latitude as number).toFixed(5)},${(
        s.longitude as number
      ).toFixed(5)}`;
      const arr = byLocation.get(key);
      if (arr) arr.push(s);
      else byLocation.set(key, [s]);
    });
    return [...byLocation.values()].map((arr) =>
      arr.slice().sort((a, b) => a.section.localeCompare(b.section)),
    );
  }, [points]);

  const bbox = useMemo(() => {
    if (!points.length) return undefined;
    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity;
    points.forEach((s) => {
      const lat = s.latitude as number;
      const lng = s.longitude as number;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    });
    return { minLat, maxLat, minLng, maxLng };
  }, [points]);

  const bounds: LatLngBoundsExpression | undefined = useMemo(
    () =>
      bbox
        ? [
            [bbox.minLat, bbox.minLng],
            [bbox.maxLat, bbox.maxLng],
          ]
        : undefined,
    [bbox],
  );

  if (!points.length || !bounds || !bbox) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground"
        style={{ height: `${size[1]}px`, width: `${size[0]}px` }}
      >
        {t("no_map_data") || "No map data"}
      </div>
    );
  }

  return (
    <div
      className="relative"
      style={{ height: `${size[1]}px`, width: `${size[0]}px` }}
    >
      <MapContainer
        className="w-full h-full"
        bounds={bounds}
        boundsOptions={{ padding: [20, 20] }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {groups.map((group) => {
          const head = group[0];
          const lat = head.latitude as number;
          const lng = head.longitude as number;
          const isProblem = markerVariant === "problem";
          const topParty = topVotesParty(mergeVotes(group));
          const fillColor = topParty?.color || "lightslategrey";
          const strokeColor = isProblem ? "#dc2626" : fillColor;

          if (group.length === 1) {
            return (
              <SingleSectionMarker
                key={head.section}
                section={head}
                position={[lat, lng]}
                fillColor={fillColor}
                strokeColor={strokeColor}
                isProblem={isProblem}
                badge={tooltipBadge}
              />
            );
          }

          // Shared location: a count badge marker that opens the paginated card.
          const icon = divIcon({
            className: "section-count-icon",
            html: `<span style="background:${fillColor};${
              isProblem ? "border-color:#dc2626;" : ""
            }">${group.length}</span>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          });

          return (
            <SharedLocationMarker
              key={head.section}
              group={group}
              position={[lat, lng]}
              icon={icon}
              badge={tooltipBadge}
            />
          );
        })}
      </MapContainer>
    </div>
  );
};
