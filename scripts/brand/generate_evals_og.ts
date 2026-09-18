/**
 * OG image (1200×630) for the chat evals page (naiasno.bg/chat/evals).
 *
 *   npx tsx scripts/brand/generate_evals_og.ts
 *
 * Number-led, on-brand (navy + coral). Writes public/og/chat-evals.png, which
 * ships through the static-asset copy; the postbuild image pass
 * (scripts/images/optimize.ts) turns it into the .webp the page's og:image
 * names. Also ai/assets/evals-og.png, for the standalone AI build.
 *
 * ⚠️ READS THE PUBLISHED MANIFEST, never a hard-coded figure: every number comes
 * from data/ai/evals/index.json — the same file the page renders — so the card
 * cannot say something the page no longer does. It showed the retired
 * fc_eval.json model comparison (Gemini 3.1 / Gemma / FunctionGemma, "104
 * tools") for weeks after the page had moved on, because it read a different
 * artifact than the page did.
 *
 * The story it tells is the page's: on questions written with typos, four ways
 * to pick a tool, on the same questions (Bulgarian).
 */
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drawWordmark, FONT, THEME } from "../posts/cardKit";
import { SITE_HOST } from "../../src/lib/siteOrigin";
import { TOOLS } from "../../ai/tools/registry";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "ai/assets/evals-og.png");
const OUT_PUBLIC = join(ROOT, "public/og/chat-evals.png");
const MANIFEST = join(ROOT, "data/ai/evals/index.json");
/** The cell the card is about: Bulgarian, written with typos. */
const CELL = "all|bg:typo";

type Ctx = SKRSContext2D;
const pal = THEME.dark;

export type Bar = { label: string; pct: number; hero?: boolean };

type Manifest = {
  robustness?: {
    summary: Record<
      string,
      { rules: number | null; gemini: number | null; jevGemini: number | null }
    >;
    noAi?: Record<string, { right: number }>;
  } | null;
};

/** The four methods on the card's cell, in the order the page reads them.
 *  Throws rather than drawing a card from a manifest that lacks them — a
 *  fallback figure is exactly how the old card went stale. */
export const readBars = (m: Manifest): Bar[] => {
  const s = m.robustness?.summary?.[CELL];
  const noAi = m.robustness?.noAi?.[CELL];
  if (!s || s.rules == null || s.gemini == null || s.jevGemini == null || !noAi)
    throw new Error(`${MANIFEST} has no robustness figures for ${CELL}`);
  const pct = (v: number) => Math.round(v * 100);
  return [
    { label: "Правила", pct: pct(s.rules) },
    { label: "Jev + правила", pct: pct(noAi.right) },
    { label: "Само Gemini", pct: pct(s.gemini) },
    { label: "Jev + Gemini", pct: pct(s.jevGemini), hero: true },
  ];
};

const main = () => {
  const W = 1200;
  const H = 630;
  const bars = readBars(JSON.parse(readFileSync(MANIFEST, "utf8")));
  const hero = bars.find((b) => b.hero)!;
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
  drawWordmark(ctx, PAD, 120, 54, pal);
  ctx.font = `800 54px ${FONT}`;
  const wmW = ctx.measureText("наясно").width;
  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle = pal.accent;
  ctx.fillText("AI", PAD + wmW + 16, 120);

  // kicker
  ctx.font = `600 28px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText("Как оценяваме AI чата", PAD, 184);

  // hero number (left column)
  ctx.font = `800 150px ${FONT}`;
  ctx.fillStyle = pal.accent;
  ctx.fillText(`${hero.pct}%`, PAD - 4, 350);

  ctx.font = `600 34px ${FONT}`;
  ctx.fillStyle = pal.text;
  ctx.fillText("верен инструмент", PAD, 408);
  ctx.fillText("при въпроси с грешки", PAD, 450);
  ctx.font = `500 28px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText(`Jev + Gemini · ${TOOLS.length} инструмента`, PAD, 496);

  // right column: the four methods on the same questions, as bars
  const X0 = 650;
  const LABEL_W = 210;
  const BAR_X = X0 + LABEL_W;
  const BAR_W = W - PAD - BAR_X - 70; // leaves room for the % label
  const ROW = 64;
  const Y0 = 240;
  ctx.font = `600 22px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText("Същите въпроси с грешки, на български", X0, Y0 - 34);
  bars.forEach((b, i) => {
    const y = Y0 + i * ROW;
    ctx.textAlign = "left";
    ctx.font = `${b.hero ? 700 : 500} 24px ${FONT}`;
    ctx.fillStyle = b.hero ? pal.text : pal.muted;
    ctx.fillText(b.label, X0, y + 22);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, BAR_X, y + 4, BAR_W, 22, 6);
    ctx.fill();
    ctx.fillStyle = b.hero ? pal.accent : "rgba(154,167,189,0.55)";
    roundRect(ctx, BAR_X, y + 4, Math.max(8, (BAR_W * b.pct) / 100), 22, 6);
    ctx.fill();
    ctx.font = `800 24px ${FONT}`;
    ctx.fillStyle = b.hero ? pal.accent : pal.text;
    ctx.fillText(`${b.pct}%`, BAR_X + BAR_W + 12, y + 23);
  });

  // bottom: url (left) + tagline (right)
  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle = pal.accent;
  ctx.textAlign = "left";
  ctx.fillText(`${SITE_HOST}/chat/evals`, PAD, H - 34);
  ctx.font = `500 24px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.textAlign = "right";
  ctx.fillText("отворен бенчмарк · отворен код", W - PAD, H - 36);

  const buf = canvas.toBuffer("image/png");
  writeFileSync(OUT, buf);
  writeFileSync(OUT_PUBLIC, buf);
  console.error(
    `wrote ${OUT_PUBLIC} (${bars.map((b) => `${b.label} ${b.pct}%`).join(", ")})`,
  );
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

if (process.argv[1]?.endsWith("generate_evals_og.ts")) main();
