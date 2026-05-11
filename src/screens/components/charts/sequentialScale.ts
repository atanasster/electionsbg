// Colorblind-safe sequential palettes for choropleths. Hex values are the
// ColorBrewer 6-class schemes (https://colorbrewer2.org/). Hand-rolled to
// avoid pulling in d3-scale-chromatic just for this lookup.

export type SequentialPalette = "YlOrRd" | "Greens";

const STOPS: Record<SequentialPalette, string[]> = {
  YlOrRd: ["#ffffb2", "#fed976", "#feb24c", "#fd8d3c", "#f03b20", "#bd0026"],
  Greens: ["#edf8e9", "#c7e9c0", "#a1d99b", "#74c476", "#31a354", "#006d2c"],
};

// Bucket a value in [0, max] into one of `stops.length` quantile buckets
// using fixed equal-width breaks. We deliberately use equal-width (not Jenks
// or quantile-of-data) so the same value reads the same color across
// elections — the perceptual mapping is stable, which matters when a
// journalist screenshots the map.
export const sequentialColor = (
  value: number | undefined,
  domainMax: number,
  palette: SequentialPalette = "YlOrRd",
): string => {
  if (value === undefined || isNaN(value)) return "hsl(var(--muted))";
  const stops = STOPS[palette];
  const clamped = Math.max(0, Math.min(domainMax, value));
  const idx = Math.min(
    stops.length - 1,
    Math.floor((clamped / domainMax) * stops.length),
  );
  return stops[idx];
};

export const sequentialLegend = (
  domainMax: number,
  palette: SequentialPalette = "YlOrRd",
): { color: string; from: number; to: number }[] => {
  const stops = STOPS[palette];
  const step = domainMax / stops.length;
  return stops.map((color, i) => ({
    color,
    from: i * step,
    to: (i + 1) * step,
  }));
};
