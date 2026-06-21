// Shared terracotta ramp for the procurement choropleths (6 buckets, light →
// dark). Kept in its own module so both the map fills (ProcurementOblastMap)
// and the tile's legend swatches (ProcurementChoroplethTile) read one source
// and can never drift apart.
export const PROCUREMENT_RAMP = [
  "#f3e3d3",
  "#e6c19b",
  "#d99a5b",
  "#c2710c",
  "#97560a",
  "#5f3705",
];
