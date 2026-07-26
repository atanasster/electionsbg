// Color helpers for the vote↔demographic municipality map. The map paints each
// município by its local contribution to the party↔demographic Pearson r:
// concordant municipalities (vote and demographic co-deviate) firm up toward the
// party's brand color, discordant ones toward an "opposing" complementary color,
// and neutral ones (near either mean) stay grey.

export type Rgb = [number, number, number];

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

// Parse "#rgb", "#rrggbb", "rgb()/rgba()", or "hsl()" into an RGB triplet.
export const parseColor = (c: string): Rgb | null => {
  const s = c.trim().toLowerCase();
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return [r, g, b];
    }
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    return null;
  }
  const rgb = s.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const parts = rgb[1]
      .split(/[,\s/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length >= 3) return [parts[0], parts[1], parts[2]];
    return null;
  }
  const hsl = s.match(/hsla?\(([^)]+)\)/);
  if (hsl) {
    const parts = hsl[1].split(/[,\s/]+/).filter(Boolean);
    const h = parseFloat(parts[0]);
    const sPct = parseFloat(parts[1]) / 100;
    const lPct = parseFloat(parts[2]) / 100;
    return hslToRgb([h, sPct, lPct]);
  }
  return null;
};

// h in [0,360), s/l in [0,1].
export const rgbToHsl = ([r, g, b]: Rgb): [number, number, number] => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h *= 60;
  }
  return [h, s, l];
};

export const hslToRgb = ([h, s, l]: [number, number, number]): Rgb => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  // Wrap hue fully into [0, 360) before scaling to the [0, 6) sextant index —
  // a bare +360 without the second mod leaves hp as high as ~12 and drops every
  // hue past 60° into the wrong branch.
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
};

// The "opposing" color: the party hue rotated 180°, normalized to a vivid,
// mid-light tone so it reads as a clean contrast regardless of how dark or
// desaturated the brand color is.
export const opposingColor = (partyColor: string): Rgb => {
  const rgb = parseColor(partyColor) ?? [120, 120, 120];
  const [h, s] = rgbToHsl(rgb);
  return hslToRgb([h + 180, clamp(Math.max(s, 0.6), 0, 1), 0.48]);
};

export const rgbStr = ([r, g, b]: Rgb): string => `rgb(${r}, ${g}, ${b})`;

export const mix = (a: Rgb, b: Rgb, t: number): Rgb => {
  const k = clamp(t, 0, 1);
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
};

// Neutral grey both for "≈ 0 contribution" and the diverging scale's midpoint.
export const NEUTRAL_RGB: Rgb = [214, 214, 214];
