// Builders for the optional `Envelope.geo` map overlay. Each returns a
// `GeoOverlay` a tool can attach in one line. The geojson feature properties
// already use the app's own codes, so NO NUTS conversion is needed:
//   - /regions_map.json            feature.nuts3 = МИР/oblast code (VAR, S23, PDV-00)
//   - /maps/regions/<oblast>.json  feature.nuts4 = obshtina code (VAR01)
//   - /maps/municipalities/<ob>.json  feature.ekatte = settlement EKATTE
// Vote/indicator datasets carry the matching code (region key / obshtina /
// ekatte), so the join is direct. Abroad (МИР "32") has no polygon and is
// silently skipped by the renderer.

import { OBLASTS } from "./place";
import type { ColumnFormat, GeoArea, GeoOverlay } from "./types";

// The 31 per-oblast municipality-geometry files (everything except abroad "32").
const OBLAST_CODES = Object.keys(OBLASTS).filter((c) => c !== "32");

// The synthetic Sofia município ("SOF"/"SOF00") has no single nuts4 polygon — on
// the muni map Sofia is its 24 районни shards (in the S23/S24/S25 oblast files).
// Painting Sofia means painting those 24 districts, so a Sofia área is expanded
// into one área per district (same value/colour/label) before joining; otherwise
// the capital is left blank.
const SOFIA_DISTRICT_NUTS4 = [
  "S2302",
  "S2308",
  "S2309",
  "S2310",
  "S2315",
  "S2316",
  "S2317",
  "S2323",
  "S2401",
  "S2403",
  "S2404",
  "S2405",
  "S2406",
  "S2407",
  "S2414",
  "S2422",
  "S2511",
  "S2512",
  "S2513",
  "S2518",
  "S2519",
  "S2520",
  "S2521",
  "S2524",
];
const SOFIA_SYNTHETIC = new Set(["SOF", "SOF00"]);
const expandSofia = (areas: GeoArea[]): GeoArea[] =>
  areas.flatMap((a) =>
    SOFIA_SYNTHETIC.has(a.code)
      ? SOFIA_DISTRICT_NUTS4.map((code) => ({ ...a, code }))
      : [a],
  );

// A few big cities form their own МИР, split from the surrounding province in the
// geojson: Plovdiv-grad (PDV-00, holding município PDV22) vs Plovdiv-oblast (PDV).
// The city município is administratively part of the province, so an oblast muni
// map must also load the city sibling's geometry or that município renders blank.
const CITY_MIR_SIBLINGS: Record<string, string[]> = { PDV: ["PDV-00"] };
const oblastSources = (oblastCode: string): string[] =>
  [oblastCode, ...(CITY_MIR_SIBLINGS[oblastCode] ?? [])].map(
    (c) => `/maps/regions/${c}.json`,
  );

type ChoroplethOpts = {
  metricLabel: string;
  format?: ColumnFormat;
  colorMode?: "ramp" | "explicit";
};

// Country map of all 31 oblasti (incl. Sofia's 3 МИР), joined on the МИР code.
export const oblastChoropleth = (
  areas: GeoArea[],
  opts: ChoroplethOpts,
): GeoOverlay => ({
  level: "oblast",
  mode: "choropleth",
  source: "/regions_map.json",
  joinKey: "nuts3",
  metricLabel: opts.metricLabel,
  format: opts.format,
  colorMode: opts.colorMode ?? "ramp",
  areas,
});

// Municipalities within one oblast, joined on the obshtina code. Loads the city
// МИР sibling too (e.g. PDV + PDV-00) and expands a synthetic Sofia área.
export const muniChoropleth = (
  oblastCode: string,
  areas: GeoArea[],
  opts: ChoroplethOpts,
): GeoOverlay => ({
  level: "municipality",
  mode: "choropleth",
  source: oblastSources(oblastCode),
  joinKey: "nuts4",
  metricLabel: opts.metricLabel,
  format: opts.format,
  colorMode: opts.colorMode ?? "ramp",
  areas: expandSofia(areas),
});

// Every municipality in the country (31 oblast files merged), joined on obshtina.
// A synthetic Sofia área is expanded into its 24 district shards (the S23/S24/S25
// files are already in the merged source).
export const nationMuniChoropleth = (
  areas: GeoArea[],
  opts: ChoroplethOpts,
): GeoOverlay => ({
  level: "municipality",
  mode: "choropleth",
  source: OBLAST_CODES.map((c) => `/maps/regions/${c}.json`),
  joinKey: "nuts4",
  metricLabel: opts.metricLabel,
  format: opts.format,
  colorMode: opts.colorMode ?? "ramp",
  areas: expandSofia(areas),
});

// Settlements within one municipality, joined on EKATTE.
export const settlementChoropleth = (
  obshtina: string,
  areas: GeoArea[],
  opts: ChoroplethOpts,
): GeoOverlay => ({
  level: "settlement",
  mode: "choropleth",
  source: `/maps/municipalities/${obshtina}.json`,
  joinKey: "ekatte",
  metricLabel: opts.metricLabel,
  format: opts.format,
  colorMode: opts.colorMode ?? "ramp",
  areas,
});

// ---- locators (highlight a single resolved place) ---------------------------

// Highlight one oblast on the country map.
export const oblastLocator = (code: string, label: string): GeoOverlay => ({
  level: "oblast",
  mode: "locator",
  source: "/regions_map.json",
  joinKey: "nuts3",
  metricLabel: label,
  areas: [{ code, label }],
  focus: [code],
});

// Highlight one municipality on its oblast map. Sofia's synthetic "SOF" has no
// single nuts4 polygon, so it falls back to highlighting Sofia's 3 МИР on the
// country map.
export const muniLocator = (
  obshtina: string,
  oblastCode: string,
  label: string,
): GeoOverlay => {
  if (obshtina === "SOF") {
    const codes = ["S23", "S24", "S25"];
    return {
      level: "oblast",
      mode: "locator",
      source: "/regions_map.json",
      joinKey: "nuts3",
      metricLabel: label,
      areas: codes.map((c) => ({ code: c, label })),
      focus: codes,
    };
  }
  return {
    level: "municipality",
    mode: "locator",
    source: `/maps/regions/${oblastCode}.json`,
    joinKey: "nuts4",
    metricLabel: label,
    areas: [{ code: obshtina, label }],
    focus: [obshtina],
  };
};

// Highlight one settlement on its municipality map.
export const settlementLocator = (
  ekatte: string,
  obshtina: string,
  label: string,
): GeoOverlay => ({
  level: "settlement",
  mode: "locator",
  source: `/maps/municipalities/${obshtina}.json`,
  joinKey: "ekatte",
  metricLabel: label,
  areas: [{ code: ekatte, label }],
  focus: [ekatte],
});
