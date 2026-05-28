// Leaflet map of EU-funded projects in the município. Each pin is one
// contract from the geocoded slim file (top-200 by totalEur per município).
// OpenStreetMap tiles per the architectural decision.
//
// Performance: map mounts inside an expand-to-show section so the Leaflet
// chunk + tile fetches happen only when the user opts in. Most users want
// the rest of the dashboard immediately; this tile is the "explore" path.
//
// Auto-hides when the município has zero geocoded pins (small village
// municipalities with no EU-funded activity).

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPin, ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  useFundsGeoPins,
  type FundsGeoPin,
} from "@/data/funds/useFundsGeoPins";

type Props = {
  obshtina: string;
};

const formatEur = (n: number): string =>
  new Intl.NumberFormat("bg-BG", {
    maximumFractionDigits: 0,
    style: "currency",
    currency: "EUR",
  }).format(n);

// Compute a tight bounding box around a set of pins, padded slightly so
// markers near the edge aren't clipped. Returns a (south, west, north, east)
// tuple Leaflet's fitBounds understands.
const computeBounds = (pins: FundsGeoPin[]) => {
  if (pins.length === 0) return null;
  let minLat = pins[0].lat;
  let maxLat = pins[0].lat;
  let minLon = pins[0].lon;
  let maxLon = pins[0].lon;
  for (const p of pins) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  // Pad by 5% so edge markers aren't clipped.
  const latPad = (maxLat - minLat) * 0.05 || 0.005;
  const lonPad = (maxLon - minLon) * 0.05 || 0.005;
  return {
    south: minLat - latPad,
    west: minLon - lonPad,
    north: maxLat + latPad,
    east: maxLon + lonPad,
    center: [(minLat + maxLat) / 2, (minLon + maxLon) / 2] as [number, number],
  };
};

// Radius for the marker — scaled by totalEur (sqrt for area, capped). Small
// projects: 4 px; large: 14 px. Helps the user spot big-money pins at a
// glance without reading every label.
const radiusFor = (eur: number, maxEur: number): number => {
  if (maxEur === 0) return 6;
  const ratio = Math.sqrt(eur / maxEur);
  return 4 + ratio * 10;
};

const colorForStatus = (status: string): string => {
  if (/Приключен/.test(status)) return "#56A86F"; // completed
  if (/изпълнение/.test(status)) return "#E0A22C"; // in progress
  return "#888"; // other / cancelled / etc.
};

// Lazy module to avoid pulling Leaflet into the initial bundle. The
// vendor-leaflet chunk is ~150 KB gz — too heavy for the My-Area first
// paint unless the user explicitly opens this tile.
const loadLeaflet = async () => {
  const [{ MapContainer, TileLayer, CircleMarker, Tooltip }, _l] =
    await Promise.all([
      import("react-leaflet"),
      import("leaflet/dist/leaflet.css"),
    ]);
  void _l;
  return { MapContainer, TileLayer, CircleMarker, Tooltip };
};

type LeafletExports = Awaited<ReturnType<typeof loadLeaflet>>;

const LeafletMap: FC<{ pins: FundsGeoPin[] }> = ({ pins }) => {
  const [mod, setMod] = useState<LeafletExports | null>(null);

  // Load Leaflet on mount. The outer tile only mounts this component when
  // the user expands the section, so this `useEffect` (via useState init
  // workaround) is the late-load trigger.
  useMemo(() => {
    loadLeaflet().then(setMod);
  }, []);

  const bounds = useMemo(() => computeBounds(pins), [pins]);
  const maxEur = useMemo(
    () => pins.reduce((m, p) => (p.totalEur > m ? p.totalEur : m), 0),
    [pins],
  );

  if (!mod || !bounds || pins.length === 0) {
    return (
      <div className="h-[360px] w-full rounded-md border bg-card/50 animate-pulse" />
    );
  }

  const { MapContainer, TileLayer, CircleMarker, Tooltip } = mod;

  return (
    <div className="h-[360px] w-full rounded-md overflow-hidden border">
      <MapContainer
        center={bounds.center}
        bounds={[
          [bounds.south, bounds.west],
          [bounds.north, bounds.east],
        ]}
        className="h-full w-full"
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map((p, i) => (
          <CircleMarker
            key={`${p.contractNumber}-${i}`}
            center={[p.lat, p.lon]}
            radius={radiusFor(p.totalEur, maxEur)}
            pathOptions={{
              color: colorForStatus(p.status),
              fillColor: colorForStatus(p.status),
              fillOpacity: 0.55,
              weight: 1,
            }}
          >
            <Tooltip>
              <div className="max-w-[260px] text-xs">
                <div className="font-semibold mb-1 line-clamp-2">{p.title}</div>
                <div className="text-muted-foreground">{p.programName}</div>
                <div className="tabular-nums font-bold mt-1">
                  {formatEur(p.totalEur)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {p.status}
                </div>
              </div>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
};

export const MyAreaProjectsMapTile: FC<Props> = ({ obshtina }) => {
  const { t } = useTranslation();
  const data = useFundsGeoPins(obshtina);
  const [expanded, setExpanded] = useState(false);

  if (!data || data.pins.length === 0) return null;

  return (
    <Card className="p-4" id="myarea-projects-map">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="w-full flex items-center gap-2 text-left"
      >
        <MapPin className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_projects_map_title")}
        </h2>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {data.pins.length}{" "}
          {data.pins.length === 1 ? t("project_singular") : t("project_plural")}
        </span>
        {expanded ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>
      {expanded ? (
        <div className="mt-3">
          <LeafletMap pins={data.pins} />
          <p className="text-[10px] text-muted-foreground mt-2">
            {t("my_area_projects_map_caveat", {
              shown: data.pins.length,
              total: data.sourceContractCount,
            })}
          </p>
        </div>
      ) : null}
    </Card>
  );
};
