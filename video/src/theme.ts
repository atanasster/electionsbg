/**
 * Наясно video tokens — ported from `scripts/posts/cardKit.ts` so a card and a
 * video of the same finding are one design language and there is one place to
 * change the look.
 *
 * The PALETTE is copied verbatim. The TYPE SCALE is not: cardKit is tuned for a
 * 1080x1080 still viewed at full size, while a Reel is viewed on a phone at arm's
 * length, so the minimums below come from Remotion's video-layout guidance
 * instead (headline >= 84px, supporting >= 44px, key content >= 80px from the
 * sides and >= 100px from top and bottom, at 1080 wide).
 */

export type ThemeName = "dark" | "light";

export type Palette = {
  bg: string;
  bg2: string;
  text: string;
  muted: string;
  /** Coral — the brand accent. Positive/subject series. */
  accent: string;
  /** Counterpart to `accent` for two-direction charts. */
  cool: string;
  /** Hairline for axes and rules. */
  rule: string;
};

export const THEME: Record<ThemeName, Palette> = {
  dark: {
    bg: "#0b1224",
    bg2: "#070b16",
    text: "#f2f5f8",
    muted: "#9aa7bd",
    accent: "#df6b43",
    cool: "#4e9aa6",
    rule: "#22304d",
  },
  light: {
    bg: "#f1ece0",
    bg2: "#e5dbc4",
    text: "#221f1b",
    muted: "#6b6459",
    accent: "#df6b43",
    cool: "#2f7683",
    rule: "#cfc4ac",
  },
};

export const FONT =
  '"Inter", system-ui, -apple-system, "Helvetica Neue", "Segoe UI", "Roboto", "DejaVu Sans", sans-serif';

/**
 * Every size is expressed against a 1080px-wide composition and scaled by the
 * actual width, so one set of components serves 1080x1920 (Reels), 1080x1080
 * (FB feed) and 1920x1080 (YouTube) without a second type scale.
 */
export const BASE_WIDTH = 1080;
export const scale = (width: number) => width / BASE_WIDTH;

/** Minimums from the video-layout guidance, in base (1080-wide) pixels. */
export const TYPE = {
  /** The number itself — the thing the viewer should notice first. */
  hero: 168,
  headline: 84,
  support: 44,
  caption: 38,
  kicker: 34,
} as const;

/** Safe area in base pixels — key content never crosses these. */
export const SAFE = { x: 80, y: 100 } as const;

/**
 * Scene beats in SECONDS, not frames. Per-item animation is driven by time since
 * that item's own trigger with a constant duration — never by a slice of a global
 * progress value, which makes short items flash past (see references/scenes.md).
 */
export const BEAT = {
  /** Entrance of a scene's primary element. */
  in: 0.45,
  /** One bar/row growing. Constant per item regardless of how many there are. */
  item: 0.6,
  /** Gap between consecutive items in a staggered set. */
  stagger: 0.18,
} as const;

/** Bulgarian number formatting — decimal comma, space thousands separator. */
export const bg = {
  num: (n: number, decimals = 0) =>
    n.toLocaleString("bg-BG", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }),
  eur: (n: number, decimals = 2) =>
    `${n.toLocaleString("bg-BG", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })} €`,
};
