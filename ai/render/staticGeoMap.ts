// Tile-free static SVG render of an answer's `GeoOverlay`, for PNG/PDF export.
//
// The live chat map (GeoChoropleth.tsx) draws the choropleth over CARTO raster
// tiles, which taint the html2canvas export canvas — so the live map is dropped
// from exports. This module redraws the SAME geometry + colours as pure SVG
// `<path>`s with no basemap (the live map already hides tile labels, so nothing
// the design relies on is lost), using the site's d3 mercator projection. The
// GeoJSON is fetched through the shared cache, so it reuses what the live map
// already loaded.

import { getDataProjection } from "@/screens/components/maps/d3_utils";
import { fetchData } from "../tools/dataClient";
import type { GeoOverlay, Lang } from "../tools/types";
import {
  fmtValue,
  geoAreaByCode,
  geoFocusSet,
  geoStyleFor,
  geoValueRange,
  hsla,
  readGeoTheme,
} from "./geoStyle";

const SVG_NS = "http://www.w3.org/2000/svg";
const W = 720;
const MAP_H = 440;
const LEGEND_H = 34;

type GeoFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};
type FeatureCollection = { type: "FeatureCollection"; features: GeoFeature[] };

const el = (
  name: string,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElement => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text != null) node.textContent = text;
  return node;
};

// Build a standalone <svg> for the overlay. Returns null when no geometry
// resolves, so the caller can simply skip the map (as the live renderer does on
// fetch failure).
export const buildGeoSvg = async (
  geo: GeoOverlay,
  lang: Lang,
): Promise<SVGSVGElement | null> => {
  const sources = Array.isArray(geo.source) ? geo.source : [geo.source];
  const collections = await Promise.all(
    sources.map((s) => fetchData<FeatureCollection>(s).catch(() => null)),
  );
  const features = collections
    .filter((c): c is FeatureCollection => !!c?.features)
    .flatMap((c) => c.features);
  if (features.length === 0) return null;

  const theme = readGeoTheme();
  const range = geoValueRange(geo);
  const [min, max] = range;
  const areaByCode = geoAreaByCode(geo);
  const focusSet = geoFocusSet(geo);

  const hasLegend =
    geo.mode === "choropleth" && geo.colorMode !== "explicit" && max > min;
  const height = MAP_H + (hasLegend ? LEGEND_H : 0);

  // Fit the projection to the relevant features: the whole source for a
  // choropleth, just the focus polygons for a locator (mirrors FitBounds).
  const fit =
    geo.mode === "locator"
      ? features.filter((f) =>
          focusSet.has(String(f.properties?.[geo.joinKey] ?? "")),
        )
      : features;
  const { path } = getDataProjection(
    {
      type: "FeatureCollection",
      features: fit.length ? fit : features,
    } as unknown as Parameters<typeof getDataProjection>[0],
    [W, MAP_H, W, MAP_H],
  );
  const draw = path as unknown as (o: unknown) => string | null;

  const svg = el("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${W} ${height}`,
    width: W,
    height,
  }) as SVGSVGElement;
  svg.style.cssText = "display:block;width:100%;height:auto;";

  for (const f of features) {
    const d = draw(f);
    if (!d) continue;
    const code = String(f.properties?.[geo.joinKey] ?? "");
    const s = geoStyleFor(geo, code, { range, theme, areaByCode, focusSet });
    svg.appendChild(
      el("path", {
        d,
        fill: s.fill,
        "fill-opacity": s.fillOpacity,
        stroke: s.stroke,
        "stroke-width": s.strokeWidth,
        "stroke-linejoin": "round",
      }),
    );
  }

  // Frame the map area (matches the card's rounded border around the live map).
  svg.appendChild(
    el("rect", {
      x: 0.5,
      y: 0.5,
      width: W - 1,
      height: MAP_H - 1,
      rx: 8,
      fill: "none",
      stroke: hsla(theme.border, 0.7),
      "stroke-width": 1,
    }),
  );

  // Sequential-ramp legend (a stepped bar + min/max), right-aligned beneath the
  // map with the metric label on the left — the same row the live map shows.
  if (hasLegend) {
    const cy = MAP_H + LEGEND_H / 2;
    const steps = 16;
    const barW = 80;
    const segW = barW / steps;
    const barRight = W - 92;
    const barLeft = barRight - barW;
    svg.appendChild(
      el(
        "text",
        {
          x: 8,
          y: cy,
          "dominant-baseline": "middle",
          "font-size": 12,
          "font-family": "sans-serif",
          fill: hsla(theme.muted, 1),
        },
        geo.metricLabel,
      ),
    );
    svg.appendChild(
      el(
        "text",
        {
          x: barLeft - 6,
          y: cy,
          "dominant-baseline": "middle",
          "text-anchor": "end",
          "font-size": 11,
          "font-family": "sans-serif",
          fill: hsla(theme.muted, 1),
        },
        fmtValue(min, geo.format, lang),
      ),
    );
    for (let i = 0; i < steps; i++) {
      svg.appendChild(
        el("rect", {
          x: barLeft + i * segW,
          y: cy - 4,
          width: segW + 0.5,
          height: 8,
          rx: i === 0 ? 2 : 0,
          fill: hsla(theme.ramp, 0.18 + (0.7 * i) / (steps - 1)),
        }),
      );
    }
    svg.appendChild(
      el(
        "text",
        {
          x: barRight + 6,
          y: cy,
          "dominant-baseline": "middle",
          "font-size": 11,
          "font-family": "sans-serif",
          fill: hsla(theme.muted, 1),
        },
        fmtValue(max, geo.format, lang),
      ),
    );
  }

  return svg;
};

// Rasterize a built SVG to a PNG data URL (for jsPDF's addImage). Pure vector
// fills, so the canvas is never tainted. White-backed because the PDF page is.
export const svgToPng = (
  svg: SVGSVGElement,
  scale = 2,
): Promise<{ dataUrl: string; width: number; height: number }> => {
  const vb = (svg.getAttribute("viewBox") ?? `0 0 ${W} ${MAP_H}`)
    .split(/\s+/)
    .map(Number);
  const width = vb[2];
  const height = vb[3];
  const xml = new XMLSerializer().serializeToString(svg);
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({ dataUrl: canvas.toDataURL("image/png"), width, height });
    };
    img.onerror = () => reject(new Error("svg rasterize failed"));
    img.src = src;
  });
};
