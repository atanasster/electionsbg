// Colour ramp for the procurement treemaps (ProcurementTreemapTile +
// CompanyPortfolioTreemap). Kept in a plain module — separate from the
// TreemapCell component — so fast-refresh stays happy.
//
// Why per-rank shading: the tail of these charts is long (up to ~24 cells) and
// most cells land in the cool/slate end. A fixed palette indexed-and-clamped
// collapsed every tail tile to a SINGLE slate, so neighbours were
// indistinguishable apart from the thin border. Instead we keep the top cells
// on the warm ramp and spread the remaining cells ACROSS a graduated slate
// sub-ramp, giving every tile its own shade.

// Top ranks: saturated terracotta fading to tan.
const WARM = ["#b45309", "#c2710c", "#d97706", "#e08a1e", "#e8a23d", "#efb968"];

// Tail ranks: light → dark slate. Interpolated so a long tail still varies.
const COOL = ["#b8bcc4", "#94a3b8", "#7e8ba2", "#64748b", "#51607a"];

const hexToRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Linear interpolation across the stops of a ramp at frac ∈ [0, 1].
const sampleRamp = (stops: string[], frac: number): string => {
  const f = Math.max(0, Math.min(1, frac));
  const seg = f * (stops.length - 1);
  const i = Math.floor(seg);
  const j = Math.min(i + 1, stops.length - 1);
  const t = seg - i;
  const [r1, g1, b1] = hexToRgb(stops[i]);
  const [r2, g2, b2] = hexToRgb(stops[j]);
  const mix = (a: number, b: number): number => Math.round(a + (b - a) * t);
  return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
};

// Colour for cell rank `index` out of `count` cells. Top WARM.length cells take
// the warm ramp by index; the rest spread evenly across the cool sub-ramp.
export const treemapCellColor = (index: number, count: number): string => {
  if (index < WARM.length) return WARM[Math.min(index, WARM.length - 1)];
  const tailCount = Math.max(1, count - WARM.length);
  const k = index - WARM.length;
  return sampleRamp(COOL, tailCount <= 1 ? 0 : k / (tailCount - 1));
};
