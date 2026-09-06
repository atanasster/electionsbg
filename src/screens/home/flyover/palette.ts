// The browser's palette for the flyover engine — `docs/plans/home-flyover-v1.md` §4.
//
// ⚠️ THE ENGINE HOLDS NO HEX AND PARSES NOTHING BUT HEX. `mixHex` is its one colour
// operation, and for anything it cannot parse it returns the nearer END — which silently
// flattens the column shading, posterises the price ramp, turns the election cross-fade into a
// hard cut and makes the highlight a full replace, all four at once, at a 200.
//
// This repo's CSS variables are BARE HSL TRIPLES (`--background: 39 33% 92%`, consumed as
// `hsl(var(--background))`), so forwarding them would hit exactly that. This module is the
// conversion, and it is the reason the theme can reach the canvas at all.

import type { FlyoverPalette } from "@/lib/flyover/layers";

/** `H S% L%` (this repo's variable form) → `#rrggbb`. */
export const hslTripleToHex = (triple: string): string | null => {
  const m = triple.trim().match(/^(-?[\d.]+)\s+(-?[\d.]+)%\s+(-?[\d.]+)%$/);
  if (!m) return null;
  const h = ((Number(m[1]) % 360) + 360) % 360;
  const s = Math.min(100, Math.max(0, Number(m[2]))) / 100;
  const l = Math.min(100, Math.max(0, Number(m[3]))) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m0 = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const to2 = (v: number) =>
    Math.round((v + m0) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
};

/**
 * The fallback palette, used verbatim when the document has no CSS variables to read — a
 * jsdom test, a server render, or a stylesheet that has not applied yet.
 *
 * ⚠️ It is a COMPLETE palette rather than a partial one, because a half-resolved palette is
 * how a scene ends up with two colour systems in it. The values are the brand's dark ground,
 * which is also what the posters use, so the canvas and the `<img>` it replaces agree.
 */
export const FALLBACK_PALETTE: FlyoverPalette = {
  land: "#132038",
  landEdge: "#25344f",
  landHighlight: "#df6b43",
  column: { proc: "#4ea3d8", funds: "#9b7fd4", agri: "#5fbf78" },
  arcIn: "#df6b43",
  arcOut: "#5fbf78",
  arcNeutral: "#7d8ba4",
  label: "#f2f5f8",
  labelHalo: "#0b1224",
  priceDown: "#5fbf78",
  priceUp: "#df6b43",
};

/**
 * Read one CSS custom property and convert it, or fall back.
 *
 * ⚠️ EVERY failure returns the fallback rather than a partial parse: `getComputedStyle`
 * returns `""` for an unset variable and `rgb(…)` for a resolved colour property, and neither
 * is something `mixHex` can use.
 */
const varHex = (
  styles: CSSStyleDeclaration,
  name: string,
  fallback: string,
): string => {
  const raw = styles.getPropertyValue(name);
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(trimmed)) return trimmed;
  return hslTripleToHex(trimmed) ?? fallback;
};

/**
 * The palette for the current theme.
 *
 * Only the two structural colours follow the theme — the land and its edge — so the scene
 * sits in the page rather than on it. The money colours, the arc directions and the price
 * ramp are the BRAND's and stay fixed: they carry meaning (which layer, which direction,
 * cheaper or dearer), and a meaning that changed colour with the theme would have to be
 * re-learned in the dark.
 */
export const readPalette = (root?: Element | null): FlyoverPalette => {
  if (typeof getComputedStyle !== "function") return FALLBACK_PALETTE;
  const el =
    root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!el) return FALLBACK_PALETTE;
  let styles: CSSStyleDeclaration;
  try {
    styles = getComputedStyle(el);
  } catch {
    return FALLBACK_PALETTE;
  }
  return {
    ...FALLBACK_PALETTE,
    land: varHex(styles, "--card", FALLBACK_PALETTE.land),
    landEdge: varHex(styles, "--border", FALLBACK_PALETTE.landEdge),
    label: varHex(styles, "--foreground", FALLBACK_PALETTE.label),
    labelHalo: varHex(styles, "--background", FALLBACK_PALETTE.labelHalo),
  };
};
