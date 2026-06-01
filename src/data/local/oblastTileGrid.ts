// Tile-grid (cartogram) layout for Bulgaria's 28 oblasti: one equal-size cell
// per oblast, positioned to approximate the country's geography (col = west→
// east, row = north→south). Drives the alternate "tile map" view on the
// national local-elections maps, so a tiny-area / high-population oblast
// (Sofia-grad, Gabrovo) reads at the same visual weight as a large rural one
// (Burgas) — the equal-area read a leader-coloured choropleth can't give.
//
// `SOF` is Sofia city (the local synthetic oblast); `SFO` is the surrounding
// Sofia province. The three parliamentary МИР (S23/S24/S25) are NOT tiles here
// — the city is one cell, coloured from the SOF summary row.

export type OblastTile = { code: string; x: number; y: number };

export const OBLAST_TILE_COLS = 10;
export const OBLAST_TILE_ROWS = 5;

export const OBLAST_TILE_GRID: OblastTile[] = [
  // North / Danube tier
  { code: "VID", x: 0, y: 0 },
  { code: "MON", x: 1, y: 0 },
  { code: "VRC", x: 2, y: 0 },
  { code: "PVN", x: 3, y: 0 },
  { code: "RSE", x: 5, y: 0 },
  { code: "RAZ", x: 7, y: 0 },
  { code: "SLS", x: 8, y: 0 },
  { code: "DOB", x: 9, y: 0 },
  // Second tier
  { code: "LOV", x: 3, y: 1 },
  { code: "VTR", x: 4, y: 1 },
  { code: "TGV", x: 5, y: 1 },
  { code: "SHU", x: 6, y: 1 },
  { code: "VAR", x: 8, y: 1 },
  // Central tier
  { code: "KNL", x: 0, y: 2 },
  { code: "PER", x: 1, y: 2 },
  { code: "SOF", x: 2, y: 2 },
  { code: "SFO", x: 3, y: 2 },
  { code: "GAB", x: 4, y: 2 },
  // Thracian plain
  { code: "PAZ", x: 3, y: 3 },
  { code: "PDV", x: 4, y: 3 },
  { code: "SZR", x: 5, y: 3 },
  { code: "SLV", x: 6, y: 3 },
  { code: "JAM", x: 7, y: 3 },
  { code: "BGS", x: 8, y: 3 },
  // Southern border
  { code: "BLG", x: 0, y: 4 },
  { code: "SML", x: 3, y: 4 },
  { code: "KRZ", x: 4, y: 4 },
  { code: "HKV", x: 5, y: 4 },
];

// Pick a readable label colour for a given hex fill (relative luminance).
export const tileTextColor = (hex?: string): string => {
  if (!hex || !/^#?[0-9a-fA-F]{6}$/.test(hex.replace("#", "")))
    return "#ffffff";
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#1f2937" : "#ffffff";
};

// Map a turnout percentage to a fill alpha (more turnout → more saturated).
// Bulgarian local turnout sits roughly in the 30–75% band per oblast.
export const turnoutAlpha = (pct: number | null | undefined): number => {
  if (pct == null) return 0.18;
  const a = (pct - 30) / (75 - 30);
  return Math.max(0.22, Math.min(1, a));
};
