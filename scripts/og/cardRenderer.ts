import { Canvas, createCanvas, type SKRSContext2D } from "@napi-rs/canvas";

// 1200x630 — Twitter Summary Large Image / OG default. Mirrors the browser
// renderer in src/ux/cardExport/dashboardCard.ts so the site has a single
// visual language across user-shared and search-engine-served previews.
export const W = 1200;
export const H = 630;

export const PALETTE = {
  bg: "#ffffff",
  text: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  accentBg: "#f8fafc",
  green: "#059669",
  red: "#dc2626",
  amber: "#d97706",
  brand: "#0c4587",
};

// Cyrillic-capable system fallback chain. @napi-rs/canvas ships with a
// reasonable default font set; we fall back through common Linux/macOS fonts.
export const FONT_STACK =
  '"Inter", system-ui, -apple-system, "Helvetica Neue", "Segoe UI", "Roboto", "DejaVu Sans", sans-serif';

export type Tile = {
  label: string;
  value: string;
  delta?: string;
  deltaColor?: string;
  accent?: string; // small color dot before the value (e.g. party color)
};

export type CardSpec = {
  title: string;
  subtitle?: string;
  tiles: Tile[]; // up to 4
  footerLeft?: string;
  footerRight?: string;
};

const drawRoundedRect = (
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

const drawTile = (
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tile: Tile,
) => {
  ctx.fillStyle = PALETTE.accentBg;
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, x, y, w, h, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = PALETTE.muted;
  ctx.font = `600 16px ${FONT_STACK}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(tile.label.toUpperCase(), x + 24, y + 24);

  let textX = x + 24;
  if (tile.accent) {
    ctx.fillStyle = tile.accent;
    ctx.beginPath();
    ctx.arc(x + 24 + 10, y + 78, 10, 0, Math.PI * 2);
    ctx.fill();
    textX = x + 24 + 28;
  }

  ctx.fillStyle = PALETTE.text;
  ctx.textBaseline = "middle";
  const valueMaxW = w - (textX - x) - 24;
  let fontSize = 48;
  do {
    ctx.font = `700 ${fontSize}px ${FONT_STACK}`;
    if (ctx.measureText(tile.value).width <= valueMaxW) break;
    fontSize -= 2;
  } while (fontSize > 24);
  ctx.fillText(tile.value, textX, y + 78);

  if (tile.delta) {
    ctx.fillStyle = tile.deltaColor || PALETTE.muted;
    ctx.font = `600 22px ${FONT_STACK}`;
    ctx.fillText(tile.delta, x + 24, y + 130);
  }
};

const drawHeader = (ctx: SKRSContext2D, title: string, subtitle?: string) => {
  ctx.fillStyle = PALETTE.brand;
  ctx.fillRect(0, 0, W, 6);

  ctx.fillStyle = PALETTE.text;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // Auto-shrink the title to fit within the available width.
  let titleSize = 44;
  const titleMaxW = W - 120;
  do {
    ctx.font = `800 ${titleSize}px ${FONT_STACK}`;
    if (ctx.measureText(title).width <= titleMaxW) break;
    titleSize -= 2;
  } while (titleSize > 24);
  ctx.fillText(title, 60, 56);

  if (subtitle) {
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `500 24px ${FONT_STACK}`;
    ctx.fillText(subtitle, 60, 110);
  }
};

const drawFooter = (ctx: SKRSContext2D, left: string, right: string) => {
  ctx.fillStyle = PALETTE.muted;
  ctx.font = `500 18px ${FONT_STACK}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(left, 60, H - 32);

  ctx.textAlign = "right";
  ctx.fillText(right, W - 60, H - 32);

  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, H - 56);
  ctx.lineTo(W - 60, H - 56);
  ctx.stroke();
};

export const renderCard = (spec: CardSpec): Canvas => {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as SKRSContext2D;

  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, W, H);

  drawHeader(ctx, spec.title, spec.subtitle);

  // Tile row
  const tiles = spec.tiles.slice(0, 4);
  const top = 180;
  const bottom = H - 80;
  const innerH = bottom - top;
  const sideMargin = 60;
  const gap = 20;
  const tileCount = tiles.length || 1;
  const tileW = (W - 2 * sideMargin - (tileCount - 1) * gap) / tileCount;

  tiles.forEach((tile, i) => {
    const x = sideMargin + i * (tileW + gap);
    drawTile(ctx, x, top, tileW, innerH, tile);
  });

  drawFooter(ctx, spec.footerLeft ?? "electionsbg.com", spec.footerRight ?? "");

  return canvas;
};
