/**
 * Shared card renderer for Наясно social posts. Reuses the site theme
 * colours (src/index.css): dark navy background + coral-peach accent.
 * Crisp Cyrillic via @napi-rs/canvas (image models mangle Cyrillic).
 *
 * Used by the `naiasno-post` skill via scripts/posts/post_tool.ts.
 */
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";

type Ctx = SKRSContext2D;

export const FONT =
  '"Inter", system-ui, -apple-system, "Helvetica Neue", "Segoe UI", "Roboto", "DejaVu Sans", sans-serif';

export type Theme = "dark" | "light";
type Palette = {
  bg: string;
  bg2: string;
  text: string;
  muted: string;
  accent: string;
};
export const THEME: Record<Theme, Palette> = {
  dark: {
    bg: "#0b1224",
    bg2: "#070b16",
    text: "#f2f5f8",
    muted: "#9aa7bd",
    accent: "#df6b43",
  },
  light: {
    bg: "#f1ece0",
    bg2: "#e5dbc4",
    text: "#221f1b",
    muted: "#6b6459",
    accent: "#df6b43",
  },
};

const roundRect = (
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

/** Wordmark "наясно" with an accent swipe under the "ясно" half. */
export const drawWordmark = (
  ctx: Ctx,
  x: number,
  baseline: number,
  size: number,
  pal: Palette,
) => {
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const naW = ctx.measureText("на").width;
  const yasnoW = ctx.measureText("ясно").width;
  ctx.fillStyle = pal.accent;
  roundRect(
    ctx,
    x + naW - size * 0.03,
    baseline + size * 0.08,
    yasnoW + size * 0.06,
    size * 0.17,
    size * 0.06,
  );
  ctx.fill();
  ctx.fillStyle = pal.text;
  ctx.fillText("наясно", x, baseline);
};

export type StatCardSpec = {
  value: string; // e.g. "2,4 млрд. лв." or "147"
  label: string; // plain-language claim; use \n for line breaks
  source: string; // e.g. "Източник: АОП"
  kicker?: string; // small label above the number
  cta?: string; // default "виж разбивката"
  theme?: Theme; // default "dark"
};

/** 1080×1080 number-led native post card. Returns a PNG buffer. */
export const renderStatCard = (spec: StatCardSpec): Buffer => {
  const S = 1080;
  const pal = THEME[spec.theme ?? "dark"];
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, pal.bg2);
  g.addColorStop(1, pal.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  drawWordmark(ctx, 80, 150, 60, pal);

  if (spec.kicker) {
    ctx.fillStyle = pal.muted;
    ctx.font = `600 34px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(spec.kicker.toUpperCase(), 80, 400);
  }

  // big value, auto-shrink to fit
  ctx.fillStyle = pal.accent;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let size = 210;
  do {
    ctx.font = `800 ${size}px ${FONT}`;
    if (ctx.measureText(spec.value).width <= S - 160) break;
    size -= 6;
  } while (size > 70);
  ctx.fillText(spec.value, 80, 560);

  // plain-language label
  ctx.fillStyle = pal.text;
  ctx.font = `600 46px ${FONT}`;
  let ly = 680;
  for (const line of spec.label.split("\n")) {
    ctx.fillText(line, 80, ly);
    ly += 64;
  }

  // footer: source left, CTA + triangle right
  ctx.fillStyle = pal.muted;
  ctx.font = `500 34px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(spec.source, 80, 990);

  ctx.fillStyle = pal.accent;
  ctx.textAlign = "right";
  ctx.fillText(spec.cta ?? "виж разбивката", S - 120, 990);
  ctx.beginPath();
  ctx.moveTo(S - 104, 970);
  ctx.lineTo(S - 80, 985);
  ctx.lineTo(S - 104, 1000);
  ctx.closePath();
  ctx.fill();

  return canvas.toBuffer("image/png");
};
