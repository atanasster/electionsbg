/**
 * Наясно AI — social share (OG) image generator.
 *
 * Renders the empty-state hero collage as a 1200×630 share card: the dark
 * Gemini backdrop + the same five mini answer-cards (bar / turnout line /
 * Bulgaria choropleth / hemicycle / budget donut) + the "Наясно AI" wordmark and
 * tagline. Reuses the baked oblast paths so the map matches the live hero, and
 * @napi-rs/canvas for crisp Cyrillic (Gemini/SVG rasterizers mangle it).
 *
 * Run:  node_modules/.bin/tsx scripts/brand/generate_ai_og.ts
 * Out:  ai/assets/og.png  (1200×630, referenced by ai/index.html)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanvas,
  loadImage,
  Path2D,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import sharp from "sharp";
import { BG_OBLASTS } from "../../ai/app/hero/bgOblastPaths";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT = resolve(ROOT, "ai/assets/og.png");
const BG = resolve(ROOT, "ai/assets/hero-bg-dark.webp");

const W = 1200;
const H = 630;
const FONT =
  '"Inter", system-ui, -apple-system, "Helvetica Neue", "Segoe UI", "Roboto", "DejaVu Sans", sans-serif';

// dark "sunset" theme tokens (src/App.css)
const FG = "hsl(210,25%,96%)";
const CARD = "hsl(223,38%,13%)";
const MUTED = "hsl(220,18%,70%)";
const BORDER = "hsl(222,20%,28%)";
const ACCENT = "hsl(158,60%,68%)";
const CHART = [
  "",
  "hsl(158,60%,68%)",
  "hsl(200,80%,60%)",
  "hsl(38,90%,65%)",
  "hsl(280,65%,70%)",
  "hsl(340,75%,65%)",
];

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

// ---- viz drawers (ported from ai/app/hero/MiniCards.tsx) ----
const drawBar = (ctx: Ctx, x: number, y: number, w: number, h: number) => {
  const bars = [0.92, 0.66, 0.47, 0.31, 0.19];
  const base = y + h;
  const bw = (w / bars.length) * 0.62;
  const step = w / bars.length;
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, base);
  ctx.lineTo(x + w, base);
  ctx.stroke();
  bars.forEach((b, i) => {
    const bh = b * h;
    const bx = x + i * step + (step - bw) / 2;
    ctx.fillStyle = CHART[(i % 5) + 1];
    roundRect(ctx, bx, base - bh, bw, bh, 3);
    ctx.fill();
  });
};

const drawLine = (ctx: Ctx, x: number, y: number, w: number, h: number) => {
  const ys = [0.46, 0.6, 0.5, 0.72, 0.4, 0.55, 0.34, 0.28];
  const pts = ys.map((v, i) => [x + (i * w) / (ys.length - 1), y + h - v * h]);
  // area
  ctx.beginPath();
  ctx.moveTo(pts[0][0], y + h);
  pts.forEach((p) => ctx.lineTo(p[0], p[1]));
  ctx.lineTo(pts[pts.length - 1][0], y + h);
  ctx.closePath();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = CHART[2];
  ctx.fill();
  ctx.globalAlpha = 1;
  // line
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.strokeStyle = CHART[2];
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();
  // peak marker
  const peak = pts.reduce((a, b) => (b[1] < a[1] ? b : a), pts[0]);
  ctx.beginPath();
  ctx.arc(peak[0], peak[1], 5, 0, Math.PI * 2);
  ctx.fillStyle = ACCENT;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = CARD;
  ctx.stroke();
};

const RAMP = [1, 3, 2, 4, 5];
const drawMap = (ctx: Ctx, x: number, y: number, w: number, h: number) => {
  const s = Math.min(w / 360, h / 232);
  const mw = 360 * s;
  const mh = 232 * s;
  ctx.save();
  ctx.translate(x + (w - mw) / 2, y + (h - mh) / 2);
  ctx.scale(s, s);
  ctx.lineWidth = 1 / s;
  ctx.strokeStyle = CARD;
  BG_OBLASTS.forEach((o, i) => {
    const p = new Path2D(o.d);
    ctx.globalAlpha = 0.4 + ((i * 37) % 55) / 100;
    ctx.fillStyle = CHART[RAMP[i % RAMP.length]];
    ctx.fill(p);
    ctx.globalAlpha = 1;
    ctx.stroke(p);
  });
  ctx.restore();
};

const drawHemicycle = (
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
) => {
  const cx = x + w / 2;
  const baseY = y + h;
  const maxR = Math.min(w / 2, h) * 0.96;
  const inner = maxR * 0.34;
  const rows = 5;
  const dots: { x: number; y: number; a: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const rad = inner + ((maxR - inner) * r) / (rows - 1);
    const n = Math.round(7 + r * 3.5);
    for (let i = 0; i < n; i++) {
      const a = Math.PI - (Math.PI * i) / (n - 1);
      dots.push({ x: cx + rad * Math.cos(a), y: baseY - rad * Math.sin(a), a });
    }
  }
  dots.sort((p, q) => q.a - p.a);
  const shares = [0.32, 0.24, 0.18, 0.15, 0.11];
  let cut = 0;
  const bounds = shares.map((sh) => (cut += Math.round(sh * dots.length)));
  const dotR = maxR * 0.05;
  dots.forEach((d, i) => {
    const g = bounds.findIndex((b) => i < b);
    ctx.beginPath();
    ctx.arc(d.x, d.y, dotR, 0, Math.PI * 2);
    ctx.fillStyle = CHART[g === -1 ? 5 : g + 1];
    ctx.fill();
  });
};

const drawDonut = (ctx: Ctx, x: number, y: number, w: number, h: number) => {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const R = Math.min(w, h) * 0.38;
  const shares = [0.34, 0.24, 0.18, 0.14, 0.1];
  let start = -Math.PI / 2;
  ctx.lineWidth = R * 0.46;
  shares.forEach((sh, i) => {
    const end = start + Math.PI * 2 * sh;
    ctx.beginPath();
    ctx.arc(cx, cy, R, start + 0.03, end - 0.03);
    ctx.strokeStyle = CHART[(i % 5) + 1];
    ctx.stroke();
    start = end;
  });
};

const drawCard = (
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  rot: number,
  title: string,
  source: string,
  accent: string,
  viz: (ctx: Ctx, x: number, y: number, w: number, h: number) => void,
) => {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);
  // card body + shadow
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 12;
  roundRect(ctx, 0, 0, w, h, 16);
  ctx.fillStyle = CARD;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = BORDER;
  roundRect(ctx, 0, 0, w, h, 16);
  ctx.stroke();
  // header
  const pad = 20;
  ctx.beginPath();
  ctx.arc(pad + 5, pad + 7, 5, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.fillStyle = FG;
  ctx.font = `600 19px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(title, pad + 18, pad + 13);
  // viz
  viz(ctx, pad, pad + 30, w - 2 * pad, h - 2 * pad - 30 - 24);
  // source
  ctx.fillStyle = MUTED;
  ctx.font = `500 13px ${FONT}`;
  ctx.fillText(source, pad, h - pad + 6);
  ctx.restore();
};

const main = async () => {
  mkdirSync(dirname(OUT), { recursive: true });
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  // backdrop (convert webp -> png so loadImage is happy everywhere)
  const bgPng = await sharp(BG).resize(W, H, { fit: "cover" }).png().toBuffer();
  const bg = await loadImage(bgPng);
  ctx.drawImage(bg, 0, 0, W, H);

  // top scrim for legible text
  const scrim = ctx.createLinearGradient(0, 0, 0, H);
  scrim.addColorStop(0, "rgba(7,11,22,0.78)");
  scrim.addColorStop(0.42, "rgba(7,11,22,0.32)");
  scrim.addColorStop(1, "rgba(7,11,22,0.55)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, W, H);

  // ---- headline block (centred) ----
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ACCENT;
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText("ai.electionsbg.com", W / 2, 72);

  // wordmark "Наясно AI" — Наясно in fg, AI in mint
  ctx.font = `800 58px ${FONT}`;
  const naW = ctx.measureText("Наясно ").width;
  const aiW = ctx.measureText("AI").width;
  const startX = W / 2 - (naW + aiW) / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = FG;
  ctx.fillText("Наясно ", startX, 142);
  ctx.fillStyle = ACCENT;
  ctx.fillText("AI", startX + naW, 142);

  ctx.textAlign = "center";
  ctx.fillStyle = FG;
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText("Питайте за изборите, парите и властта", W / 2, 192);
  ctx.fillStyle = MUTED;
  ctx.font = `500 19px ${FONT}`;
  ctx.fillText(
    "Резултати, активност, партии, бюджет, депутати — с числа от официалните данни.",
    W / 2,
    226,
  );

  // ---- card row ----
  const CW = 196;
  const CH = 200;
  const GAP = 20;
  const total = 5 * CW + 4 * GAP;
  const x0 = (W - total) / 2;
  const cardY = 286;
  const cards: [string, string, string, typeof drawBar, number][] = [
    ["Резултати", "Избори · ЦИК", CHART[1], drawBar, -3],
    ["Активност", "2005–2024", CHART[2], drawLine, 3],
    ["По области", "28 области", CHART[1], drawMap, -4],
    ["Депутати", "Народно събрание", CHART[4], drawHemicycle, 4],
    ["Бюджет", "Министерство на финансите", CHART[3], drawDonut, -3],
  ];
  cards.forEach(([title, src, accent, viz, rot], i) => {
    drawCard(
      ctx,
      x0 + i * (CW + GAP),
      cardY,
      CW,
      CH,
      rot,
      title,
      src,
      accent,
      viz,
    );
  });

  writeFileSync(OUT, canvas.toBuffer("image/png"));
  console.log(`-> ${OUT} (${W}x${H})`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
