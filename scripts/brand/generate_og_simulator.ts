/**
 * OG share card for /budget/simulator — "Бюджетен симулатор".
 *
 * Pure @napi-rs/canvas drawing (no Gemini, no Playwright): three stylized
 * tax-rate slider tracks on the left and a diverging gains/losses bar chart
 * on the right, on the Наясно navy background with the coral accent.
 *
 * Brand tokens mirror scripts/brand/generate_brand_art.ts, which sources
 * them from the site theme (src/App.css):
 *   navy   #0b1224  — dark --background (224 47% 8%)
 *   coral  #df6b43  — --accent (16 75% 55%)
 *   white  #f2f5f8  — dark --foreground
 *   muted  #9aa7bd  — dark --muted-foreground
 *   mint   #7ae2c0  — dark --primary (used as the "gains" green)
 *
 * Regenerate with:
 *   npx tsx scripts/brand/generate_og_simulator.ts
 *
 * Output: public/og/budget-simulator.png (1200x630)
 * Referenced by the `budget/simulator` entry in scripts/prerender/routes.ts.
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(PROJECT_ROOT, "public/og");
const OUT_FILE = resolve(OUT_DIR, "budget-simulator.png");

const W = 1200;
const H = 630;

// ---- brand tokens (see header comment / src/App.css)
const INK = "#0b1224";
const INK2 = "#070b16";
const CORAL = "#df6b43";
const WHITE = "#f2f5f8";
const MUTED = "#9aa7bd";
const BODY = "#e6eaf1";
const GREEN = "#7ae2c0"; // site dark --primary, reads as "gains"
const RED = "#e25c54"; // soft destructive red, legible on navy
const TRACK = "rgba(242,245,248,0.14)";
const FONT =
  '"Inter", system-ui, -apple-system, "Helvetica Neue", "Segoe UI", "Roboto", "DejaVu Sans", sans-serif';

type Ctx = SKRSContext2D;

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

/** Wordmark "наясно" — white, coral highlighter swipe under the "ясно" half
 *  (same construction as scripts/brand/generate_brand_art.ts). */
const drawWordmark = (ctx: Ctx, x: number, baseline: number, size: number) => {
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const naW = ctx.measureText("на").width;
  const yasnoW = ctx.measureText("ясно").width;
  ctx.fillStyle = CORAL;
  roundRect(
    ctx,
    x + naW - size * 0.03,
    baseline + size * 0.08,
    yasnoW + size * 0.06,
    size * 0.17,
    size * 0.06,
  );
  ctx.fill();
  ctx.fillStyle = WHITE;
  ctx.fillText("наясно", x, baseline);
};

const drawBackground = (ctx: Ctx) => {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, INK2);
  g.addColorStop(1, INK);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // sparse data dots (deterministic pseudo-random scatter)
  for (let i = 0; i < 160; i++) {
    const px = (i * 73.13) % W;
    const py = (i * 129.7) % H;
    ctx.globalAlpha = 0.04 + ((i * 7) % 10) / 90;
    ctx.fillStyle = i % 9 === 0 ? CORAL : "#8fa0bf";
    ctx.beginPath();
    ctx.arc(px, py, i % 9 === 0 ? 2.6 : 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // soft coral glow bottom-right
  const rg = ctx.createRadialGradient(
    W * 0.88,
    H * 0.92,
    0,
    W * 0.88,
    H * 0.92,
    W * 0.45,
  );
  rg.addColorStop(0, "rgba(223,107,67,0.22)");
  rg.addColorStop(1, "rgba(223,107,67,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
};

type Slider = { label: string; value: string; frac: number };

// Current statutory rates as knob badges; knob positions intentionally varied.
const SLIDERS: Slider[] = [
  { label: "ДДС", value: "20%", frac: 0.64 },
  { label: "ДДФЛ — плосък данък", value: "10%", frac: 0.32 },
  { label: "Корпоративен данък", value: "10%", frac: 0.46 },
];

const drawSlider = (
  ctx: Ctx,
  x: number,
  labelBaseline: number,
  w: number,
  s: Slider,
) => {
  // label + value badge
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = MUTED;
  ctx.font = `600 19px ${FONT}`;
  ctx.fillText(s.label.toUpperCase(), x, labelBaseline);
  ctx.textAlign = "right";
  ctx.fillStyle = CORAL;
  ctx.font = `800 24px ${FONT}`;
  ctx.fillText(s.value, x + w, labelBaseline + 2);
  // track
  const trackY = labelBaseline + 16;
  const trackH = 10;
  ctx.fillStyle = TRACK;
  roundRect(ctx, x, trackY, w, trackH, trackH / 2);
  ctx.fill();
  // filled portion
  const knobX = x + s.frac * w;
  ctx.fillStyle = CORAL;
  roundRect(ctx, x, trackY, knobX - x, trackH, trackH / 2);
  ctx.fill();
  // knob: coral disc with a white ring + faint glow
  const knobY = trackY + trackH / 2;
  const glow = ctx.createRadialGradient(knobX, knobY, 0, knobX, knobY, 26);
  glow.addColorStop(0, "rgba(223,107,67,0.35)");
  glow.addColorStop(1, "rgba(223,107,67,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(knobX, knobY, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = CORAL;
  ctx.beginPath();
  ctx.arc(knobX, knobY, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 2.5;
  ctx.stroke();
};

// Diverging "who gains / who loses" bars (abstract fractions of max width).
const BARS = [0.85, 0.52, 0.22, -0.38, -0.72];

const drawDivergingBars = (
  ctx: Ctx,
  cx: number,
  top: number,
  maxLen: number,
) => {
  const barH = 24;
  const gap = 13;
  const count = BARS.length;
  const chartH = count * barH + (count - 1) * gap;
  // mini legend above the bars
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 19px ${FONT}`;
  ctx.fillStyle = RED;
  ctx.textAlign = "left";
  ctx.fillText("губят", cx - maxLen, top - 14);
  ctx.fillStyle = GREEN;
  ctx.textAlign = "right";
  ctx.fillText("печелят", cx + maxLen, top - 14);
  // bars
  BARS.forEach((frac, i) => {
    const y = top + i * (barH + gap);
    const len = Math.abs(frac) * maxLen;
    ctx.fillStyle = frac >= 0 ? GREEN : RED;
    ctx.globalAlpha = 0.92;
    if (frac >= 0) roundRect(ctx, cx, y, len, barH, 6);
    else roundRect(ctx, cx - len, y, len, barH, 6);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
  // center axis on top of the bars
  ctx.strokeStyle = "rgba(242,245,248,0.45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, top - 8);
  ctx.lineTo(cx, top + chartH + 8);
  ctx.stroke();
};

const main = () => {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  drawBackground(ctx);

  // top-left wordmark
  drawWordmark(ctx, 70, 80, 38);

  // title (auto-shrink to fit) + subtitle
  const title = "Бюджетен симулатор";
  let titleSize = 62;
  const titleMaxW = W - 140;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  do {
    ctx.font = `800 ${titleSize}px ${FONT}`;
    if (ctx.measureText(title).width <= titleMaxW) break;
    titleSize -= 2;
  } while (titleSize > 36);
  ctx.fillStyle = WHITE;
  ctx.fillText(title, 70, 170);
  ctx.fillStyle = BODY;
  ctx.font = `500 30px ${FONT}`;
  ctx.fillText("Какво става, ако данък се промени?", 70, 220);

  // column headings
  ctx.fillStyle = MUTED;
  ctx.font = `700 17px ${FONT}`;
  ctx.fillText("ПРЕМЕСТИ ПЛЪЗГАЧ", 70, 296);
  ctx.fillText("КОЙ ПЕЧЕЛИ, КОЙ ГУБИ", 680, 296);

  // left column: sliders
  const sliderX = 70;
  const sliderW = 510;
  SLIDERS.forEach((s, i) => {
    drawSlider(ctx, sliderX, 352 + i * 84, sliderW, s);
  });

  // right column: diverging bars
  drawDivergingBars(ctx, 895, 344, 215);

  // footer
  ctx.strokeStyle = "rgba(154,167,189,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(70, 572);
  ctx.lineTo(W - 70, 572);
  ctx.stroke();
  ctx.fillStyle = MUTED;
  ctx.font = `500 20px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("electionsbg.com", 70, 604);
  ctx.textAlign = "right";
  ctx.fillText("бюджет / симулатор", W - 70, 604);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, canvas.toBuffer("image/png"));
  const kb = Math.round(statSync(OUT_FILE).size / 1024);
  console.log(`-> public/og/budget-simulator.png (${W}x${H}, ${kb} KB)`);
};

main();
