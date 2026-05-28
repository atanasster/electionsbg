// EU-funded projects in the município. Default view is a preview list of
// the biggest projects (title + amount + status); the full geocoded
// Leaflet map loads on demand via "view all on map". This follows the
// "show some → view all" pattern: the project list is long (up to 200
// per município) and the heavy interactive map (~150 KB gz Leaflet chunk
// + tile fetches) stays off the first-paint path until the user asks.
//
// Auto-hides when the município has zero geocoded pins (small village
// municipalities with no EU-funded activity).

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPin, Map as MapIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  useFundsGeoPins,
  type FundsGeoPin,
} from "@/data/funds/useFundsGeoPins";
import { useFundsForMuni } from "@/data/funds/useFundsForPlace";

type Props = {
  obshtina: string;
};

const PREVIEW_CAP = 5;

const formatPerCapita = (eur: number, lang: "bg" | "en"): string => {
  const v = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    maximumFractionDigits: 0,
  }).format(eur);
  return lang === "bg" ? `${v} €/жител` : `€${v}/capita`;
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
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const data = useFundsGeoPins(obshtina);
  // Slim (<5 KB) per-município summary carrying the pre-computed
  // per-capita EUR and the cohort rank — the comparison context.
  const { data: summary } = useFundsForMuni(obshtina);
  const [showMap, setShowMap] = useState(false);

  // Top projects by money, for the default preview list.
  const topPins = useMemo(() => {
    if (!data) return [];
    return [...data.pins]
      .sort((a, b) => b.totalEur - a.totalEur)
      .slice(0, PREVIEW_CAP);
  }, [data]);

  if (!data || data.pins.length === 0) return null;

  const perCapita =
    summary?.perCapitaEur != null && summary.perCapitaEur > 0
      ? summary.perCapitaEur
      : null;
  const rank = summary?.perCapitaRank ?? null;
  const cohort = summary?.cohortSize ?? null;

  return (
    <Card className="p-4 flex flex-col gap-3" id="myarea-projects-map">
      <div className="flex items-center gap-2">
        <MapPin className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_projects_map_title")}
        </h2>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {data.pins.length}{" "}
          {data.pins.length === 1 ? t("project_singular") : t("project_plural")}
        </span>
      </div>

      {/* Per-capita comparison line — EU funds per resident + cohort rank.
          Comes pre-computed from the funds summary; renders only when the
          município has a population-normalised figure. */}
      {perCapita != null ? (
        <div className="text-xs text-muted-foreground -mt-1">
          <span className="font-semibold text-foreground tabular-nums">
            {formatPerCapita(perCapita, lang)}
          </span>
          {rank != null && cohort != null ? (
            <>
              {" · "}
              {lang === "bg"
                ? `място ${rank} от ${cohort} общини`
                : `rank ${rank} of ${cohort} municipalities`}
            </>
          ) : null}
        </div>
      ) : null}

      {showMap ? (
        <>
          <LeafletMap pins={data.pins} />
          <p className="text-[10px] text-muted-foreground">
            {t("my_area_projects_map_caveat", {
              shown: data.pins.length,
              total: data.sourceContractCount,
            })}
          </p>
        </>
      ) : (
        <>
          {/* Default preview — the biggest projects by money. */}
          <ul className="flex flex-col">
            {topPins.map((p, i) => (
              <li
                key={`${p.contractNumber}-${i}`}
                className="flex items-start gap-2 py-1.5 text-xs border-b last:border-b-0"
              >
                <span
                  className="size-2 rounded-full shrink-0 mt-1"
                  style={{ backgroundColor: colorForStatus(p.status) }}
                  aria-hidden
                />
                <span className="flex-1 min-w-0">
                  <span className="line-clamp-2" title={p.title}>
                    {p.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {p.programName}
                  </span>
                </span>
                <span className="tabular-nums font-medium shrink-0">
                  {formatEur(p.totalEur)}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setShowMap(true)}
            className="flex items-center justify-center gap-2 text-sm font-medium text-primary rounded-md border p-2 hover:bg-accent/40 transition-colors"
          >
            <MapIcon className="size-4" />
            {lang === "bg"
              ? `Виж всички ${data.pins.length} на карта`
              : `View all ${data.pins.length} on the map`}
          </button>
        </>
      )}
    </Card>
  );
};
