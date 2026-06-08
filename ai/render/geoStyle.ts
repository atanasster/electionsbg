// Shared, framework-free styling + formatting for an answer's `GeoOverlay`. Used
// by BOTH the live Leaflet choropleth (ai/render/GeoChoropleth.tsx) and the
// tile-free static SVG renderer used for PNG/PDF export (ai/render/staticGeoMap.ts),
// so an exported map matches the on-screen one exactly — same sequential ramp,
// winner colours, and locator highlight.
//
// All colours resolve the theme CSS vars to concrete `hsla()` strings, so the
// output is self-contained: no `var()` leaks into a serialized SVG / canvas.

import type { GeoArea, GeoOverlay, Lang } from "../tools/types";

export const readVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// "173 58% 39%" (CSS var triple) -> "hsla(173, 58%, 39%, a)".
export const hsla = (triple: string, alpha: number): string =>
  `hsla(${triple.split(/\s+/).join(", ")}, ${alpha})`;

export const fmtValue = (
  v: number,
  format: GeoOverlay["format"],
  lang: Lang,
): string => {
  const locale = lang === "bg" ? "bg-BG" : "en-US";
  if (format === "pct") return `${v.toLocaleString(locale)}%`;
  if (format === "int") return Math.round(v).toLocaleString(locale);
  return v.toLocaleString(locale);
};

// The five theme vars the choropleth reads, snapshotted once per render.
export type GeoTheme = {
  ramp: string; // --chart-2 — sequential hue (green/teal)
  accent: string; // --chart-1 — locator highlight
  muted: string; // --muted-foreground
  border: string; // --border
  fg: string; // --foreground (hover stroke)
};

export const readGeoTheme = (): GeoTheme => ({
  ramp: readVar("--chart-2"),
  accent: readVar("--chart-1"),
  muted: readVar("--muted-foreground"),
  border: readVar("--border"),
  fg: readVar("--foreground"),
});

// Min/max of the area values, for the sequential ramp.
export const geoValueRange = (geo: GeoOverlay): [number, number] => {
  const vals = geo.areas
    .map((a) => a.value)
    .filter((v): v is number => typeof v === "number");
  return vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 0];
};

export const geoAreaByCode = (geo: GeoOverlay): Map<string, GeoArea> =>
  new Map(geo.areas.map((a) => [a.code, a]));

export const geoFocusSet = (geo: GeoOverlay): Set<string> =>
  new Set(geo.focus ?? geo.areas.map((a) => a.code));

// A renderer-neutral fill/stroke for one area code. GeoChoropleth maps this to
// Leaflet `PathOptions`; the static SVG renderer applies it as SVG attributes.
export type GeoStyle = {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
};

export const geoStyleFor = (
  geo: GeoOverlay,
  code: string,
  ctx: {
    range: [number, number];
    theme: GeoTheme;
    areaByCode: Map<string, GeoArea>;
    focusSet: Set<string>;
  },
): GeoStyle => {
  const { range, theme, areaByCode, focusSet } = ctx;
  const [min, max] = range;
  const { ramp, accent, muted, border } = theme;
  const base = { stroke: hsla(border, 0.9), strokeWidth: 0.7 };

  if (geo.mode === "locator") {
    const on = focusSet.has(code);
    return {
      strokeWidth: on ? 1.6 : 0.5,
      stroke: on ? hsla(accent, 0.95) : hsla(border, 0.5),
      fill: on ? hsla(accent, 1) : hsla(muted, 1),
      fillOpacity: on ? 0.55 : 0.05,
    };
  }
  const area = areaByCode.get(code);
  if (!area)
    return {
      strokeWidth: 0.5,
      stroke: hsla(border, 0.5),
      fill: hsla(muted, 1),
      fillOpacity: 0.04,
    };
  if (geo.colorMode === "explicit")
    return { ...base, fill: area.color ?? hsla(ramp, 1), fillOpacity: 0.72 };
  const t =
    max > min && typeof area.value === "number"
      ? (area.value - min) / (max - min)
      : 0.5;
  return { ...base, fill: hsla(ramp, 1), fillOpacity: 0.18 + 0.7 * t };
};
