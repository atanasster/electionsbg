/**
 * OG image (1200×630) for the /tools reference page (ai.electionsbg.com/tools).
 *
 *   npx tsx scripts/brand/generate_tools_og.ts
 *
 * Number-led, on-brand (navy + coral, the site theme): the live tool count as
 * the hero, with a per-domain breakdown panel so it reads as a real reference
 * index at a glance. Crisp Cyrillic via @napi-rs/canvas. Writes
 * ai/assets/tools-og.png, which vite.config.ai.ts copies into dist-ai and the
 * generated tools.html points og:image at.
 *
 * The count + per-domain split are read straight from the tool registry, so the
 * image stays in sync whenever tools are added or removed.
 */
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drawWordmark, FONT, THEME } from "../posts/cardKit";
import { DOMAIN_LABELS, TOOLS } from "../../ai/tools/registry";
import type { Domain } from "../../ai/tools/types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "ai/assets/tools-og.png");

type Ctx = SKRSContext2D;
const pal = THEME.dark;

// Domains in display order, each with its live tool count, biggest first.
const DOMAIN_ORDER: Domain[] = [
  "elections",
  "local",
  "fiscal",
  "people",
  "indicators",
  "place",
];
const readDomains = (): {
  count: number;
  rows: { label: string; n: number }[];
} => {
  const rows = DOMAIN_ORDER.map((d) => ({
    label: DOMAIN_LABELS[d].bg,
    n: TOOLS.filter((t) => t.domain === d).length,
  }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  return { count: TOOLS.length, rows };
};

const main = () => {
  const W = 1200;
  const H = 630;
  const { count, rows } = readDomains();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  // background: navy vertical gradient + a faint coral glow top-left
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

  // wordmark + "AI"
  drawWordmark(ctx, PAD, 110, 50, pal);
  ctx.font = `800 50px ${FONT}`;
  const wmW = ctx.measureText("наясно").width;
  ctx.font = `700 28px ${FONT}`;
  ctx.fillStyle = pal.accent;
  ctx.fillText("AI", PAD + wmW + 14, 110);

  // kicker
  ctx.font = `600 27px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText("Инструменти и данни · BG / EN", PAD, 168);

  // hero number (the live tool count) + unit beneath
  ctx.font = `800 156px ${FONT}`;
  ctx.fillStyle = pal.accent;
  ctx.fillText(String(count), PAD - 4, 332);
  ctx.font = `600 46px ${FONT}`;
  ctx.fillStyle = pal.text;
  ctx.fillText("инструмента", PAD, 392);

  // two-line value prop
  ctx.font = `600 31px ${FONT}`;
  ctx.fillStyle = pal.text;
  ctx.fillText("детерминистични — реални данни", PAD, 462);
  ctx.font = `500 27px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText("всяко число е изчислено, не генерирано", PAD, 502);

  // right panel: per-domain breakdown, reads like a table of contents
  const panelX = 628;
  const panelY = 150;
  const panelW = 492;
  const panelH = 392;
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  roundRect(ctx, panelX, panelY, panelW, panelH, 26);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, panelX, panelY, panelW, panelH, 26);
  ctx.stroke();

  ctx.font = `600 26px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.textAlign = "left";
  ctx.fillText("Какво покрива", panelX + 34, panelY + 56);

  const rowH = (panelH - 130) / rows.length;
  rows.forEach((r, i) => {
    const rowY = panelY + 108 + i * rowH;
    // coral bullet square
    ctx.fillStyle = pal.accent;
    roundRect(ctx, panelX + 34, rowY - 17, 16, 16, 4);
    ctx.fill();
    // label
    ctx.font = `500 26px ${FONT}`;
    ctx.fillStyle = pal.text;
    ctx.textAlign = "left";
    ctx.fillText(r.label, panelX + 62, rowY);
    // count, right-aligned
    ctx.font = `700 26px ${FONT}`;
    ctx.fillStyle = pal.accent;
    ctx.textAlign = "right";
    ctx.fillText(String(r.n), panelX + panelW - 34, rowY);
  });

  // bottom: url (left) + tagline (right)
  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle = pal.accent;
  ctx.textAlign = "left";
  ctx.fillText("ai.electionsbg.com/tools", PAD, H - 36);
  ctx.font = `500 24px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.textAlign = "right";
  ctx.fillText("отворен код · реални данни", W - PAD, H - 38);

  writeFileSync(OUT, canvas.toBuffer("image/png"));
  console.error(`wrote ${OUT} (${count} tools, ${rows.length} domains)`);
};

// local rounded-rect (cardKit's is not exported)
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

main();
