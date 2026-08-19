/**
 * OG image (1200×630) for /procurement/methodology.
 *
 *   npx tsx scripts/brand/generate_og_procurement_methodology.ts
 *
 * The share card for a SPECIFICATION, so it leads with the thing that makes the
 * page unusual rather than with a scary number: the flags are published, with
 * their thresholds and their limits. The hero is the check count read live from
 * the catalogue, and the panel lists what the page actually documents — so the
 * card stays true if a flag is ever added.
 *
 * ⚠️ No euro figure and no "risk" number on this card, deliberately. A share
 * image is seen far more often than it is clicked, and a big red number beside
 * the word "поръчки" reads as a finding about procurement rather than as a link
 * to a methodology. The one caveat that must travel with these flags — that a
 * flag is not a verdict — is on the card itself for the same reason.
 *
 * Writes public/og/procurement-methodology.png, which the prerender's
 * `ogImage` for that route points at.
 */
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drawWordmark, FONT, THEME } from "../posts/cardKit";
import {
  CONTRACT_FLAG_LIST,
  TENDER_FLAG_LIST,
  CONTRACT_GRADE_BANDS,
} from "../../src/lib/riskFlagCatalog";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "public/og/procurement-methodology.png");

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
  ctx.fillText("Обществени поръчки · методология", PAD, 168);

  ctx.font = `800 156px ${FONT}`;
  ctx.fillStyle = pal.accent;
  ctx.fillText(String(checks), PAD - 4, 332);
  ctx.font = `600 46px ${FONT}`;
  ctx.fillStyle = pal.text;
  ctx.fillText("проверки, публикувани", PAD, 392);

  ctx.font = `600 31px ${FONT}`;
  ctx.fillStyle = pal.text;
  ctx.fillText("прагове, правно основание, обхват", PAD, 462);
  ctx.font = `500 27px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText("сигналът не е присъда — а повод за проверка", PAD, 502);

  const panelX = 628;
  const panelY = 150;
  const panelW = 492;
  const panelH = 392;
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  roundRect(ctx, panelX, panelY, panelW, panelH, 26);
  ctx.fill();

  const rows: [string, string][] = [
    ["при договор", `${CONTRACT_FLAG_LIST.length}`],
    ["при процедура", `${TENDER_FLAG_LIST.length}`],
    ["оценки A–F", `${CONTRACT_GRADE_BANDS.length}`],
    ["каталог", "MIT"],
  ];
  let y = panelY + 74;
  for (const [label, value] of rows) {
    ctx.font = `600 30px ${FONT}`;
    ctx.fillStyle = pal.text;
    ctx.fillText(label, panelX + 40, y);
    ctx.font = `800 30px ${FONT}`;
    ctx.fillStyle = pal.accent;
    ctx.textAlign = "right";
    ctx.fillText(value, panelX + panelW - 40, y);
    ctx.textAlign = "left";
    y += 62;
  }

  ctx.font = `500 24px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText("risk-flags.json · отворен каталог", panelX + 40, y + 14);

  ctx.font = `500 24px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText("electionsbg.com/procurement/methodology", PAD, 578);

  writeFileSync(OUT, canvas.toBuffer("image/png"));
  console.log(`wrote ${OUT} (${checks} checks)`);
};

main();
