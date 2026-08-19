/**
 * OG image (1200×630) for the article `2026-08-18-otvoreni-signali`.
 *
 *   npx tsx scripts/brand/generate_og_otvoreni_signali.ts
 *
 * The article's actual argument is a calibration one — the flags do NOT fire
 * everywhere — so the card leads with that number rather than with a scare
 * figure. A share image is seen far more often than it is clicked, and a big
 * red number next to "обществени поръчки" reads as an accusation about
 * procurement; "62.6% fire nothing" cannot be misread that way and is the more
 * surprising fact besides.
 *
 * The distribution is read from the catalogue's committed measurement rather
 * than typed, so the card cannot drift from the handbook that states the same
 * numbers.
 *
 * Output: public/og/otvoreni-signali.png, referenced by the article's entry in
 * public/articles/index.json.
 */
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drawWordmark, FONT, THEME } from "../posts/cardKit";
import {
  CONTRACT_FLAG_LIST,
  FIRED_COUNT_DISTRIBUTION,
  TENDER_FLAG_LIST,
} from "../../src/lib/riskFlagCatalog";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "public/og/otvoreni-signali.png");

type Ctx = SKRSContext2D;
const pal = THEME.dark;

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

const main = () => {
  const W = 1200;
  const H = 630;
  const checks = CONTRACT_FLAG_LIST.length + TENDER_FLAG_LIST.length;
  const clean = FIRED_COUNT_DISTRIBUTION[0].share; // the share firing nothing

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, pal.bg);
  g.addColorStop(1, pal.bg2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(170, 90, 0, 170, 90, 520);
  glow.addColorStop(0, "rgba(223,107,67,0.10)");
  glow.addColorStop(1, "rgba(223,107,67,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const PAD = 80;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  drawWordmark(ctx, PAD, 110, 50, pal);

  ctx.font = `600 27px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText("Обществени поръчки · отворена методология", PAD, 168);

  ctx.font = `800 150px ${FONT}`;
  ctx.fillStyle = pal.accent;
  ctx.fillText(clean, PAD - 4, 330);

  ctx.font = `600 42px ${FONT}`;
  ctx.fillStyle = pal.text;
  ctx.fillText("от договорите не задействат", PAD, 388);
  ctx.fillText("нито един сигнал", PAD, 438);

  ctx.font = `500 27px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText(
    `${checks} проверки — праговете и ограниченията вече са публични`,
    PAD,
    500,
  );

  const panelX = 700;
  const panelY = 150;
  const panelW = 420;
  const panelH = 300;
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  roundRect(ctx, panelX, panelY, panelW, panelH, 26);
  ctx.fill();

  ctx.font = `600 26px ${FONT}`;
  ctx.fillStyle = pal.text;
  ctx.fillText("задействани проверки", panelX + 36, panelY + 58);

  // The top of the distribution, as a small bar chart — the shape is the point:
  // it collapses immediately, which is what "not everywhere" looks like.
  const bars = FIRED_COUNT_DISTRIBUTION.slice(0, 5);
  const max = bars[0].contracts;
  let y = panelY + 92;
  for (const b of bars) {
    // A bar narrower than its own corner radius renders as a distorted blob
    // rather than a small bar, so the radius is clamped to half the width.
    const w = Math.max(4, Math.round((b.contracts / max) * 250));
    const r = Math.min(6, w / 2);
    ctx.font = `500 22px ${FONT}`;
    ctx.fillStyle = pal.muted;
    ctx.fillText(String(b.fired), panelX + 36, y + 16);
    ctx.fillStyle = b.fired === 0 ? "rgba(154,167,189,0.45)" : pal.accent;
    roundRect(ctx, panelX + 62, y, w, 20, r);
    ctx.fill();
    ctx.font = `500 20px ${FONT}`;
    ctx.fillStyle = pal.muted;
    ctx.fillText(b.share, panelX + 62 + w + 10, y + 16);
    y += 40;
  }

  ctx.font = `500 24px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText("electionsbg.com/procurement/methodology", PAD, 578);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, canvas.toBuffer("image/png"));
  console.log(`wrote ${OUT} (${clean} clean, ${checks} checks)`);
};

main();
