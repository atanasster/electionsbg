/**
 * OG share card for the article "Резервът на БНБ след еврото: може ли да се похарчи".
 *
 * Pure @napi-rs/canvas drawing (no Gemini, no Playwright). The composition makes
 * the article's thesis legible at a glance: of the ≈€42bn currency-board reserve,
 * only ~3.6% (€1.48bn) moved to the ECB as an accounting swap — and €0 is freed
 * for the state to spend.
 *
 * Brand tokens mirror scripts/brand/generate_og_simulator.ts, which sources them
 * from the site theme (src/App.css):
 *   navy   #0b1224  — dark --background
 *   coral  #df6b43  — --accent
 *   white  #f2f5f8  — dark --foreground
 *   muted  #9aa7bd  — dark --muted-foreground
 *
 * Regenerate with:
 *   npx tsx scripts/brand/generate_og_reserve.ts
 *
 * Output: public/og/bnb-reserve.png (1200x630)
 * Referenced by the `2026-06-13-bnb-reserve-after-euro` entry in public/articles/index.json.
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(PROJECT_ROOT, "public/og");
const OUT_FILE = resolve(OUT_DIR, "bnb-reserve.png");

const W = 1200;
const H = 630;

// ---- brand tokens (see header comment / src/App.css)
const INK = "#0b1224";
const INK2 = "#070b16";
const CORAL = "#df6b43";
const WHITE = "#f2f5f8";
const MUTED = "#9aa7bd";
const BODY = "#e6eaf1";
const STEEL_SOLID = "#465982"; // "stays in BNB" segment — neutral parked blue
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

/** The reserve as one stacked bar: 96.4% stays in BNB, 3.6% moves to the ECB. */
const drawReserveBar = (ctx: Ctx, x: number, top: number, w: number) => {
  const h = 56;
  const transferFrac = 0.036;
  const staysW = w * (1 - transferFrac);
  const transferW = w * transferFrac;

  // base "stays" segment
  ctx.fillStyle = STEEL_SOLID;
  roundRect(ctx, x, top, w, h, 10);
  ctx.fill();
  // coral "transferred to ECB" sliver at the far right
  ctx.fillStyle = CORAL;
  roundRect(ctx, x + staysW, top, transferW, h, 8);
  ctx.fill();

  // label inside the steel segment
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = WHITE;
  ctx.font = `700 23px ${FONT}`;
  ctx.fillText("ОСТАВА В БАЛАНСА НА БНБ · 96,4%", x + 24, top + h / 2 + 1);

  // connector tick from the coral sliver down to its label below the bar
  const sliverCx = x + staysW + transferW / 2;
  ctx.strokeStyle = CORAL;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sliverCx, top + h + 6);
  ctx.lineTo(sliverCx, top + h + 16);
  ctx.stroke();

  // below the bar: caption (left) + coral sliver label (right, under the sliver)
  const capY = top + h + 38;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = MUTED;
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText(
    "Счетоводна смяна на актив — не освобождаване на пари.",
    x,
    capY,
  );
  ctx.textAlign = "right";
  ctx.fillStyle = CORAL;
  ctx.font = `800 22px ${FONT}`;
  ctx.fillText("1,48 млрд € (3,6%) към ЕЦБ", x + w, capY);
};

const main = () => {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  drawBackground(ctx);

  // top-left wordmark
  drawWordmark(ctx, 70, 80, 38);

  // title (auto-shrink to fit) + subtitle
  const title = "Резервът на БНБ след еврото";
  let titleSize = 60;
  const titleMaxW = W - 140;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  do {
    ctx.font = `800 ${titleSize}px ${FONT}`;
    if (ctx.measureText(title).width <= titleMaxW) break;
    titleSize -= 2;
  } while (titleSize > 36);
  ctx.fillStyle = WHITE;
  ctx.fillText(title, 70, 168);
  ctx.fillStyle = BODY;
  ctx.font = `500 30px ${FONT}`;
  ctx.fillText("Еврото не „освобождава“ резерва за харчене", 70, 214);

  // reserve-bar block heading + amount
  ctx.fillStyle = MUTED;
  ctx.font = `700 17px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("ВАЛУТЕН РЕЗЕРВ НА БНБ · КРАЯ НА 2024", 70, 300);
  ctx.fillStyle = WHITE;
  ctx.font = `800 30px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("≈42 млрд €", W - 70, 302);

  // the stacked reserve bar
  drawReserveBar(ctx, 70, 330, W - 140);

  // punchline: 0 € free to spend
  const zeroBaseline = 525;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = CORAL;
  ctx.font = `800 84px ${FONT}`;
  ctx.fillText("0 €", 70, zeroBaseline);
  const zeroW = ctx.measureText("0 €").width;
  const capX = 70 + zeroW + 32;
  ctx.fillStyle = WHITE;
  ctx.font = `700 27px ${FONT}`;
  ctx.fillText("свободни за държавата да похарчи", capX, zeroBaseline - 30);
  ctx.fillStyle = MUTED;
  ctx.font = `500 23px ${FONT}`;
  ctx.fillText(
    "резервът не е бюджетен ресурс · чл. 123 ДФЕС",
    capX,
    zeroBaseline,
  );

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
  ctx.fillText("анализи", W - 70, 604);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, canvas.toBuffer("image/png"));
  const kb = Math.round(statSync(OUT_FILE).size / 1024);
  console.log(`-> public/og/bnb-reserve.png (${W}x${H}, ${kb} KB)`);
};

main();
