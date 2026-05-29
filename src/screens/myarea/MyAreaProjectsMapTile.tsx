// EU-funded projects in the município. Default view is a scrollable list of
// every project (title + amount + status), biggest money first; a "view on
// map" toggle swaps in the geocoded subset on a Leaflet map. The heavy
// interactive map (~150 KB gz Leaflet chunk + tile fetches) stays off the
// first-paint path until the user opens it. Both views read one slim file
// (by-muni-geo/<obshtina>.json, top-200 contracts) — never the full corpus.
//
// Auto-hides when the município has no EU-funded contracts at all. The map
// toggle is hidden when none of the listed contracts carry coordinates.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { MapPin, Map as MapIcon, List as ListIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  useFundsGeoPins,
  type FundsGeoPin,
} from "@/data/funds/useFundsGeoPins";
import { useFundsForMuni } from "@/data/funds/useFundsForPlace";

type Props = {
  obshtina: string;
};

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
      <div className="h-full w-full rounded-md border bg-card/50 animate-pulse" />
    );
  }

  const { MapContainer, TileLayer, CircleMarker, Tooltip } = mod;

  return (
    <div className="h-full w-full rounded-md overflow-hidden border">
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

// Sofia районы share the synthetic Stolichna anchor (S22) for EU-funds
// attribution: ИСУН records гр.София contracts at EKATTE 68134 (the
// city), not at район granularity. The resolver routes those into S22,
// while районы with named kmet villages (Панчарево, Банкя, Кремиковци,
// …) accumulate their own contracts from village-level attribution. So
// when a район has its own contracts we render them; otherwise we fall
// back to the citywide S22 list and label the tile accordingly.
const SOFIA_CITY_KEY = "S22";
const isSofiaDistrict = (obshtina: string): boolean =>
  /^S2[3-5]\d{2}$/i.test(obshtina);

export const MyAreaProjectsMapTile: FC<Props> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const primary = useFundsGeoPins(obshtina);
  // Only triggers a fetch for Sofia районы — `useFundsGeoPins` is
  // disabled when its arg is null, so non-Sofia dashboards pay nothing.
  const cityFallback = useFundsGeoPins(
    isSofiaDistrict(obshtina) ? SOFIA_CITY_KEY : null,
  );
  // True when the район itself has zero EU-funded contracts and we're
  // showing the citywide rollup instead. Drives the header label and the
  // per-capita summary lookup.
  const usingCityFallback =
    isSofiaDistrict(obshtina) &&
    (!primary || primary.contracts.length === 0) &&
    !!cityFallback &&
    cityFallback.contracts.length > 0;
  const data = usingCityFallback ? cityFallback : primary;
  // Slim (<5 KB) per-município summary carrying the pre-computed
  // per-capita EUR and the cohort rank — the comparison context. When
  // we fell back to S22 we read its summary for the same per-capita.
  const summaryKey = usingCityFallback ? SOFIA_CITY_KEY : obshtina;
  const { data: summary } = useFundsForMuni(summaryKey);
  const [view, setView] = useState<"list" | "map">("list");

  // All projects, largest money first — the scrollable list.
  const contracts = useMemo(() => {
    if (!data) return [];
    return [...data.contracts].sort((a, b) => b.totalEur - a.totalEur);
  }, [data]);

  // The geocoded subset — the only ones the map can pin.
  const pins = useMemo(
    () =>
      contracts.filter((c): c is FundsGeoPin => c.lat != null && c.lon != null),
    [contracts],
  );

  if (!data || data.contracts.length === 0) return null;

  const perCapita =
    summary?.perCapitaEur != null && summary.perCapitaEur > 0
      ? summary.perCapitaEur
      : null;
  const rank = summary?.perCapitaRank ?? null;
  const cohort = summary?.cohortSize ?? null;

  return (
    // On lg the Card matches its row-track height (sibling-driven) by having
    // its content absolutely positioned — the Card itself contributes 0 to
    // the grid auto-row sizing, so the row sizes to the taller sibling.
    <Card className="lg:relative lg:h-full" id="myarea-projects-map">
      <div className="p-4 flex flex-col gap-3 lg:absolute lg:inset-0">
        <div className="flex items-center gap-2">
          <MapPin className="size-4 text-primary" />
          <h2 className="text-sm font-semibold flex-1">
            {t("my_area_projects_map_title")}
            {usingCityFallback ? (
              <span className="font-normal text-muted-foreground">
                {lang === "bg"
                  ? " — гр. София (общинско ниво)"
                  : " — Sofia city (município level)"}
              </span>
            ) : null}
          </h2>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {data.sourceContractCount}{" "}
            {data.sourceContractCount === 1
              ? t("project_singular")
              : t("project_plural")}
          </span>
        </div>
        {usingCityFallback ? (
          <p className="text-[11px] text-muted-foreground -mt-1 leading-snug">
            {lang === "bg"
              ? "ИСУН не разбива проектите по район — показваме сборните данни за Столична община."
              : "ISUN doesn't break projects down by район — showing the citywide rollup for Stolichna obshtina."}
          </p>
        ) : null}

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
                  ? `място ${rank} от ${cohort} общини в областта`
                  : `rank ${rank} of ${cohort} in the province`}
              </>
            ) : null}
          </div>
        ) : null}

        {view === "map" ? (
          <>
            <div className="h-[360px] lg:h-auto lg:flex-1 lg:min-h-[300px]">
              <LeafletMap pins={pins} />
            </div>
            <p className="text-[10px] text-muted-foreground">
              {t("my_area_projects_map_caveat", {
                shown: pins.length,
                total: data.sourceContractCount,
              })}
            </p>
            <button
              type="button"
              onClick={() => setView("list")}
              className="mt-auto flex items-center justify-center gap-2 text-sm font-medium text-primary rounded-md border p-2 hover:bg-accent/40 transition-colors"
            >
              <ListIcon className="size-4" />
              {lang === "bg" ? "Към списъка с проекти" : "Back to project list"}
            </button>
          </>
        ) : (
          <>
            {/* Full scrollable list of projects, biggest money first. */}
            <ul className="flex flex-col max-h-[340px] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto pr-1">
              {contracts.map((p, i) => (
                <li
                  key={`${p.contractNumber}-${i}`}
                  className="border-b last:border-b-0"
                >
                  <Link
                    to={`/funds/contract/${encodeURIComponent(p.contractNumber)}`}
                    className="flex items-start gap-2 py-1.5 text-xs rounded hover:bg-muted/50 transition-colors -mx-1 px-1"
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
                  </Link>
                </li>
              ))}
            </ul>
            {contracts.length < data.sourceContractCount ? (
              <p className="text-[10px] text-muted-foreground">
                {t("my_area_projects_list_caveat", {
                  shown: contracts.length,
                  total: data.sourceContractCount,
                })}
              </p>
            ) : null}
            {pins.length > 0 ? (
              <button
                type="button"
                onClick={() => setView("map")}
                className="mt-auto flex items-center justify-center gap-2 text-sm font-medium text-primary rounded-md border p-2 hover:bg-accent/40 transition-colors"
              >
                <MapIcon className="size-4" />
                {lang === "bg" ? "Виж на карта" : "View on map"}
              </button>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
};
