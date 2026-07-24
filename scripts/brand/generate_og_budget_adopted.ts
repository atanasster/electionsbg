/**
 * OG share card for the article "Бюджет 2026: приет на седмия месец — какво
 * показват числата" (2026-08-05-budget-2026-adopted).
 *
 * Pure @napi-rs/canvas drawing (no Gemini, no Playwright). The composition makes
 * the article's distinctive finding legible at a glance: the law fixes a 5,7%
 * КФП-deficit ceiling, but central-budget cash execution through May 2026
 * (+2,0% revenue YoY against a plan needing +8,2%, applied to the 2023-25
 * seasonality) points to an outturn nearer ~3,9% of GDP — a ceiling, not a
 * forecast. The smaller bar is labelled explicitly as our projection so it does
 * not read as an assertion.
 *
 * Brand tokens mirror scripts/brand/generate_og_reserve.ts, which sources them
 * from the site theme (src/App.css):
 *   navy   #0b1224  — dark --background
 *   coral  #df6b43  — --accent
 *   white  #f2f5f8  — dark --foreground
 *   muted  #9aa7bd  — dark --muted-foreground
 *
 * Regenerate with:
 *   npx tsx scripts/brand/generate_og_budget_adopted.ts
 *
 * Output: public/og/budget-2026-adopted.png (1200x630)
 * Referenced by the `2026-08-05-budget-2026-adopted` entry in
 * public/articles/index.json.
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(PROJECT_ROOT, "public/og");
const OUT_FILE = resolve(OUT_DIR, "budget-2026-adopted.png");

const W = 1200;
const H = 630;

// ---- brand tokens (see header comment / src/App.css)
const INK = "#0b1224";
const INK2 = "#070b16";
const CORAL = "#df6b43";
const WHITE = "#f2f5f8";
const MUTED = "#9aa7bd";
const BODY = "#e6eaf1";
const STEEL_SOLID = "#465982"; // projected outturn — neutral parked blue
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

/** Wordmark "наясно" — white, coral highlighter swipe under the "ясно" half. */
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
    W * 0.9,
    H * 0.95,
    0,
    W * 0.9,
    H * 0.95,
    W * 0.5,
  );
  rg.addColorStop(0, "rgba(223,107,67,0.20)");
  rg.addColorStop(1, "rgba(223,107,67,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
};

/**
 * Two deficit bars sharing one % scale: the legislated 5,7% ceiling (coral) and
 * the ~3,9% outturn our run-rate points to (steel). The 3% Maastricht line is
 * marked so the reader sees both sit above it.
 */
const drawDeficitBars = (ctx: Ctx, x: number, top: number, w: number) => {
  const axisMax = 6.4; // %GDP full-scale
  const barH = 62;
  const gap = 34;
  const scale = (pct: number) => (pct / axisMax) * w;

  // 3% Maastricht reference line spanning both bars
  const maastrichtX = x + scale(3);
  const blockBottom = top + barH * 2 + gap;
  ctx.strokeStyle = "rgba(154,167,189,0.5)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(maastrichtX, top - 8);
  ctx.lineTo(maastrichtX, blockBottom + 8);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = MUTED;
  ctx.font = `600 16px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("таван по Маастрихт · 3%", maastrichtX + 8, top - 14);

  // Bar 1 — legislated ceiling 5,7% (coral)
  ctx.fillStyle = CORAL;
  roundRect(ctx, x, top, scale(5.7), barH, 10);
  ctx.fill();
  ctx.fillStyle = WHITE;
  ctx.font = `800 34px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("5,7%", x + 22, top + barH / 2 + 1);
  ctx.fillStyle = BODY;
  ctx.font = `600 20px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(
    "законовият таван по КФП",
    x + scale(5.7) + 20,
    top + barH / 2 + 7,
  );

  // Bar 2 — projected outturn ~3,9% (steel)
  const top2 = top + barH + gap;
  ctx.fillStyle = STEEL_SOLID;
  roundRect(ctx, x, top2, scale(3.9), barH, 10);
  ctx.fill();
  ctx.fillStyle = WHITE;
  ctx.font = `800 34px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText("~3,9%", x + 22, top2 + barH / 2 + 1);
  ctx.fillStyle = BODY;
  ctx.font = `600 20px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(
    "накъде сочи изпълнението към май",
    x + scale(3.9) + 20,
    top2 + barH / 2 + 7,
  );
};

const main = () => {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  drawBackground(ctx);

  // top-left wordmark
  drawWordmark(ctx, 70, 80, 38);

  // eyebrow + title + subtitle
  ctx.fillStyle = MUTED;
  ctx.font = `700 17px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("БЮДЖЕТ 2026 · ПРИЕТ НА 24 ЮЛИ", 70, 138);

  const title = "Таван, а не прогноза";
  ctx.fillStyle = WHITE;
  ctx.font = `800 60px ${FONT}`;
  ctx.fillText(title, 70, 196);
  ctx.fillStyle = BODY;
  ctx.font = `500 27px ${FONT}`;
  ctx.fillText(
    "Законът пише 5,7% дефицит — изпълнението сочи по-ниско",
    70,
    236,
  );

  // the two deficit bars
  drawDeficitBars(ctx, 70, 300, W - 260);

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
  ctx.textBaseline = "alphabetic";
  ctx.fillText("electionsbg.com", 70, 604);
  ctx.textAlign = "center";
  ctx.fillText("касово изпълнение · ян–май 2026", W / 2 + 40, 604);
  ctx.textAlign = "right";
  ctx.fillText("анализи", W - 70, 604);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, canvas.toBuffer("image/png"));
  const kb = Math.round(statSync(OUT_FILE).size / 1024);
  console.log(`-> public/og/budget-2026-adopted.png (${W}x${H}, ${kb} KB)`);
};

main();
