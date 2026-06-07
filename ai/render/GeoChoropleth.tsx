// Leaflet choropleth / locator for a chat answer's optional `Envelope.geo`.
//
// Self-contained and lazy-loaded (so leaflet only ships when an answer actually
// has a map). Fetches the geojson `source` via the ai data client, joins each
// feature to a `GeoArea` by `joinKey`, and colours it: a sequential ramp by
// value, an explicit per-area colour (winner maps), or a single-area highlight
// (locator). The numbers also live in the envelope's table/facts — this is
// purely additive, and it's wrapped in `data-export-omit` by AnswerView because
// OSM/CARTO raster tiles taint the PNG-export canvas.

import { useContext, useEffect, useMemo, useState } from "react";
import type { Layer, LatLngBoundsExpression, Path, PathOptions } from "leaflet";
import type { GeoJsonObject } from "geojson";
import {
  AttributionControl,
  GeoJSON,
  MapContainer,
  TileLayer,
  useMap,
} from "react-leaflet";
import { ThemeContext } from "@/theme/ThemeContext";
import { themeDark } from "@/theme/utils";
import { fetchData } from "../tools/dataClient";
import type { GeoArea, GeoOverlay, Lang } from "../tools/types";

// Leaflet's stylesheet, loaded dynamically so it lands in this lazy chunk rather
// than blocking the chat's first paint (mirrors src/.../maps/LeafletMap.tsx).
import("leaflet/dist/leaflet.css");

type GeoFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { coordinates: unknown };
};
type FeatureCollection = { type: "FeatureCollection"; features: GeoFeature[] };

const esc = (s: string): string =>
  s.replace(
    /[&<>"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );

// "173 58% 39%" (CSS var triple) -> "hsla(173, 58%, 39%, a)".
const readVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const hsla = (triple: string, alpha: number): string =>
  `hsla(${triple.split(/\s+/).join(", ")}, ${alpha})`;

const fmtValue = (
  v: number,
  format: GeoOverlay["format"],
  lang: Lang,
): string => {
  const locale = lang === "bg" ? "bg-BG" : "en-US";
  if (format === "pct") return `${v.toLocaleString(locale)}%`;
  if (format === "int") return Math.round(v).toLocaleString(locale);
  return v.toLocaleString(locale);
};

// Bounding box over GeoJSON [lng,lat] rings, returned as Leaflet [[lat,lng],...].
const boundsOf = (features: GeoFeature[]): LatLngBoundsExpression | null => {
  let minLat = 90,
    minLng = 180,
    maxLat = -90,
    maxLng = -180,
    found = false;
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      const [lng, lat] = node as number[];
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      found = true;
      return;
    }
    for (const child of node) walk(child);
  };
  features.forEach((f) => walk(f.geometry?.coordinates));
  if (!found) return null;
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
};

// Fit the viewport to the relevant features (whole source for a choropleth, just
// the focus polygons for a locator).
const FitBounds = ({ features }: { features: GeoFeature[] }) => {
  const map = useMap();
  useEffect(() => {
    const bounds = boundsOf(features);
    if (bounds) map.fitBounds(bounds, { padding: [8, 8] });
  }, [map, features]);
  return null;
};

const MapSkeleton = () => (
  <div className="mx-auto aspect-[3/2] w-full max-w-3xl animate-pulse rounded-lg border border-border bg-muted" />
);

const GeoChoropleth = ({ geo, lang }: { geo: GeoOverlay; lang: Lang }) => {
  const { theme } = useContext(ThemeContext);
  const isDark = theme === themeDark;
  const [data, setData] = useState<FeatureCollection | null>(null);
  const [failed, setFailed] = useState(false);

  const sourceKey = Array.isArray(geo.source)
    ? geo.source.join("|")
    : geo.source;

  useEffect(() => {
    let alive = true;
    const sources = Array.isArray(geo.source) ? geo.source : [geo.source];
    Promise.all(
      sources.map((s) => fetchData<FeatureCollection>(s).catch(() => null)),
    )
      .then((collections) => {
        if (!alive) return;
        const features = collections
          .filter((c): c is FeatureCollection => !!c?.features)
          .flatMap((c) => c.features);
        if (features.length === 0) setFailed(true);
        else setData({ type: "FeatureCollection", features });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const areaByCode = useMemo(
    () => new Map<string, GeoArea>(geo.areas.map((a) => [a.code, a])),
    [geo.areas],
  );
  const focusSet = useMemo(
    () => new Set(geo.focus ?? geo.areas.map((a) => a.code)),
    [geo.focus, geo.areas],
  );

  // value range for the sequential ramp
  const [min, max] = useMemo(() => {
    const vals = geo.areas
      .map((a) => a.value)
      .filter((v): v is number => typeof v === "number");
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 0];
  }, [geo.areas]);

  // Features to fit the viewport to: scoped source for a choropleth, just the
  // focus polygons for a locator.
  const fitFeatures = useMemo(() => {
    if (!data) return [];
    if (geo.mode === "locator")
      return data.features.filter((f) =>
        focusSet.has(String(f.properties?.[geo.joinKey] ?? "")),
      );
    return data.features;
  }, [data, geo.mode, geo.joinKey, focusSet]);

  if (failed) return null;
  if (!data) return <MapSkeleton />;

  const ramp = readVar("--chart-2"); // sequential hue (green/teal)
  const accent = readVar("--chart-1"); // locator highlight
  const muted = readVar("--muted-foreground");
  const border = readVar("--border");
  const fg = readVar("--foreground");

  const styleFor = (code: string): PathOptions => {
    const area = areaByCode.get(code);
    const stroke: PathOptions = {
      weight: 0.7,
      color: hsla(border, 0.9),
      opacity: 1,
    };
    if (geo.mode === "locator") {
      const on = focusSet.has(code);
      return {
        ...stroke,
        weight: on ? 1.6 : 0.5,
        color: on ? hsla(accent, 0.95) : hsla(border, 0.5),
        fillColor: on ? hsla(accent, 1) : hsla(muted, 1),
        fillOpacity: on ? 0.55 : 0.05,
      };
    }
    if (!area)
      return {
        ...stroke,
        weight: 0.5,
        color: hsla(border, 0.5),
        fillColor: hsla(muted, 1),
        fillOpacity: 0.04,
      };
    if (geo.colorMode === "explicit")
      return {
        ...stroke,
        fillColor: area.color ?? hsla(ramp, 1),
        fillOpacity: 0.72,
      };
    const t =
      max > min && typeof area.value === "number"
        ? (area.value - min) / (max - min)
        : 0.5;
    return { ...stroke, fillColor: hsla(ramp, 1), fillOpacity: 0.18 + 0.7 * t };
  };

  const onEach = (feature: GeoFeature, layer: Layer) => {
    const code = String(feature.properties?.[geo.joinKey] ?? "");
    const area = areaByCode.get(code);
    if (!area) return;
    if (geo.mode === "locator" && !focusSet.has(code)) return;
    const path = layer as Path;
    if (geo.mode === "locator") {
      path.bindTooltip(`<b>${esc(area.label)}</b>`, { sticky: true });
      return;
    }
    const val =
      area.display ??
      (typeof area.value === "number"
        ? fmtValue(area.value, geo.format, lang)
        : "—");
    path.bindTooltip(
      `<div style="text-align:center"><b>${esc(area.label)}</b><br/><span>${esc(geo.metricLabel)}: ${esc(val)}</span></div>`,
      { sticky: true },
    );
    path.on({
      mouseover: () => path.setStyle({ weight: 2, color: hsla(fg, 0.9) }),
      mouseout: () => path.setStyle(styleFor(code)),
    });
  };

  const showRampLegend =
    geo.mode === "choropleth" && geo.colorMode !== "explicit" && max > min;

  return (
    <div className="space-y-1.5" data-geo-map="">
      <div className="mx-auto aspect-[3/2] w-full max-w-3xl overflow-hidden rounded-lg border border-border">
        <MapContainer
          key={`${theme}-${sourceKey}`}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom={false}
          zoomSnap={0.25}
          attributionControl={false}
          className="bg-muted"
        >
          {/* No Leaflet prefix (BSD, not required); compact OSM/CARTO credit
              (ODbL + CARTO ToS — must stay visible) to save mobile width. */}
          <AttributionControl prefix={false} />
          {/* Label-free basemap: CARTO's labelled raster tiles bake in
              romanized place names with no `lang` switch, which clashes with
              the BG UI. The choropleth + region tooltips carry the names. */}
          <TileLayer
            url={
              isDark
                ? "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
                : "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
            }
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />
          <GeoJSON
            data={data as unknown as GeoJsonObject}
            style={(f) =>
              styleFor(
                String((f as GeoFeature).properties?.[geo.joinKey] ?? ""),
              )
            }
            onEachFeature={(f, layer) =>
              onEach(f as unknown as GeoFeature, layer)
            }
          />
          <FitBounds features={fitFeatures} />
        </MapContainer>
      </div>
      {showRampLegend && (
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-0.5 text-[11px] text-muted-foreground">
          <span>{geo.metricLabel}</span>
          <span className="tabular-nums">
            {fmtValue(min, geo.format, lang)}
          </span>
          <span
            aria-hidden
            className="h-2 w-20 rounded-full"
            style={{
              background: `linear-gradient(to right, ${hsla(ramp, 0.18)}, ${hsla(ramp, 0.88)})`,
            }}
          />
          <span className="tabular-nums">
            {fmtValue(max, geo.format, lang)}
          </span>
        </div>
      )}
    </div>
  );
};

export default GeoChoropleth;
