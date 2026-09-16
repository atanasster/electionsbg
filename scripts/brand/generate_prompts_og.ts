/**
 * OG image (1200×630) for the /chat/prompts directory page (naiasno.bg/chat/prompts).
 *
 *   npx tsx scripts/brand/generate_prompts_og.ts
 *
 * Number-led, on-brand (navy + coral, the site theme): the live starter prompt
 * count as the hero, with a per-category breakdown panel so it reads as an
 * organized question library at a glance. Crisp Cyrillic via @napi-rs/canvas.
 * Writes public/og/chat-prompts.png and ai/assets/prompts-og.png.
 */
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drawWordmark, FONT, THEME } from "../posts/cardKit";
import { STARTER_CATEGORIES, STARTERS } from "../../ai/app/starters";
import { SITE_HOST } from "../../src/lib/siteOrigin";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "ai/assets/prompts-og.png");
const OUT_PUBLIC = join(ROOT, "public/og/chat-prompts.png");

type Ctx = SKRSContext2D;
const pal = THEME.dark;

const readCategories = (): {
  count: number;
  rows: { label: string; n: number }[];
  totalCats: number;
} => {
  const catMap: Record<string, number> = {};
  for (const starter of STARTERS) {
    catMap[starter.category] = (catMap[starter.category] ?? 0) + 1;
  }
  const rows = STARTER_CATEGORIES.map((c) => ({
    label: c.bg,
    n: catMap[c.id] ?? 0,
  }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);
  return { count: STARTERS.length, rows, totalCats: STARTER_CATEGORIES.length };
};

const main = () => {
  const W = 1200;
  const H = 630;
  const { count, rows, totalCats } = readCategories();
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
  ctx.fillText("Примерни въпроси · BG / EN", PAD, 168);

  // hero number (the live prompt count) + unit beneath
  ctx.font = `800 156px ${FONT}`;
  ctx.fillStyle = pal.accent;
  ctx.fillText(String(count), PAD - 4, 332);
  ctx.font = `600 46px ${FONT}`;
  ctx.fillStyle = pal.text;
  ctx.fillText("готови въпроса", PAD, 392);

  // two-line value prop
  ctx.font = `600 31px ${FONT}`;
  ctx.fillStyle = pal.text;
  ctx.fillText("проверени заявки към данните", PAD, 462);
  ctx.font = `500 27px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText("по теми за избори, бюджет, поръчки и регистри", PAD, 502);

  // right panel: per-category breakdown, reads like an index
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
  ctx.fillText("Теми в каталога", panelX + 34, panelY + 56);

  ctx.font = `500 22px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.textAlign = "right";
  ctx.fillText(`общо ${totalCats} теми`, panelX + panelW - 34, panelY + 56);

  const rowH = (panelH - 130) / rows.length;
  rows.forEach((r, i) => {
    const rowY = panelY + 108 + i * rowH;
    // coral bullet square
    ctx.fillStyle = pal.accent;
    roundRect(ctx, panelX + 34, rowY - 17, 16, 16, 4);
    ctx.fill();
    // label
    ctx.font = `500 25px ${FONT}`;
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
  ctx.fillText(`${SITE_HOST}/chat/prompts`, PAD, H - 36);
  ctx.font = `500 24px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.textAlign = "right";
  ctx.fillText("отворен код · реални данни", W - PAD, H - 38);

  const buf = canvas.toBuffer("image/png");
  writeFileSync(OUT, buf);
  writeFileSync(OUT_PUBLIC, buf);
  console.error(`wrote ${OUT} (${count} prompts, ${rows.length} categories)`);
  console.error(`wrote ${OUT_PUBLIC}`);
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
