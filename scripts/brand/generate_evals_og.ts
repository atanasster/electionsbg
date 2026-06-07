/**
 * OG image (1200×630) for the /evals benchmark page (ai.electionsbg.com/evals).
 *
 *   npx tsx scripts/brand/generate_evals_og.ts
 *
 * Number-led, on-brand (navy + coral, the site theme), with a small 3-model
 * comparison so it reads as a benchmark at a glance. Crisp Cyrillic via
 * @napi-rs/canvas. Writes ai/assets/evals-og.png, which vite.config.ai.ts copies
 * into dist-ai and the generated evals.html points og:image at.
 *
 * The headline numbers are read from data/ai/evals/fc_eval.json so the image
 * stays in sync if the eval is re-run.
 */
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drawWordmark, FONT, THEME } from "../posts/cardKit";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "ai/assets/evals-og.png");
const ARTIFACT = join(ROOT, "data/ai/evals/fc_eval.json");

type Ctx = SKRSContext2D;
const pal = THEME.dark;

// Short model labels + their BG tool-selection accuracy, from the artifact.
type Bar = { label: string; pct: number };
const readBars = (): { headline: string; bars: Bar[] } => {
  const fallback = {
    headline: "96–97%",
    bars: [
      { label: "Gemini 3.1 Flash-Lite", pct: 97 },
      { label: "Gemma 4 31B", pct: 51 },
      { label: "FunctionGemma 270M", pct: 2 },
    ],
  };
  if (!existsSync(ARTIFACT)) return fallback;
  try {
    const d = JSON.parse(readFileSync(ARTIFACT, "utf8"));
    const short = (label: string) =>
      label
        .replace(/\s*\(.*\)\s*/g, "")
        .replace("Flash-Lite", "Flash-Lite")
        .trim();
    const bars: Bar[] = d.models
      .filter((m: { perLang?: unknown }) => m.perLang)
      .map((m: { label: string; perLang: { bg: { toolAcc: number } } }) => ({
        label: short(m.label),
        pct: Math.round(m.perLang.bg.toolAcc * 100),
      }));
    const gem = d.models.find((m: { label: string }) =>
      m.label.includes("Gemini"),
    );
    const en = Math.round(gem.perLang.en.toolAcc * 100);
    const bg = Math.round(gem.perLang.bg.toolAcc * 100);
    const headline =
      en === bg ? `${bg}%` : `${Math.min(en, bg)}–${Math.max(en, bg)}%`;
    return { headline, bars: bars.length ? bars : fallback.bars };
  } catch {
    return fallback;
  }
};

const main = () => {
  const W = 1200;
  const H = 630;
  const { headline, bars } = readBars();
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
  ctx.fillText("Оценка на извикване на инструменти · BG / EN", PAD, 184);

  // hero number
  ctx.font = `800 140px ${FONT}`;
  ctx.fillStyle = pal.accent;
  ctx.fillText(headline, PAD - 4, 350);

  // accent progress track under the hero (filled to the top score)
  const top = Math.max(...bars.map((b) => b.pct));
  const trackY = 392;
  const trackW = 640;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  roundRect(ctx, PAD, trackY, trackW, 14, 7);
  ctx.fill();
  ctx.fillStyle = pal.accent;
  roundRect(ctx, PAD, trackY, (trackW * top) / 100, 14, 7);
  ctx.fill();

  // sub-label (two lines)
  ctx.font = `600 36px ${FONT}`;
  ctx.fillStyle = pal.text;
  ctx.fillText("верен инструмент измежду 104 инструмента", PAD, 464);
  ctx.font = `500 31px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.fillText("на български и английски — без влошаване на BG", PAD, 506);

  // one-line model comparison (legible at thumbnail size): label muted, % coral
  let cx = PAD;
  const cy = 552;
  bars.forEach((b, i) => {
    if (i > 0) {
      ctx.font = `600 24px ${FONT}`;
      ctx.fillStyle = pal.muted;
      ctx.fillText("·", cx, cy);
      cx += ctx.measureText("·").width + 16;
    }
    ctx.font = `600 24px ${FONT}`;
    ctx.fillStyle = pal.muted;
    ctx.fillText(b.label + " ", cx, cy);
    cx += ctx.measureText(b.label + " ").width;
    ctx.font = `800 24px ${FONT}`;
    ctx.fillStyle = pal.accent;
    ctx.fillText(`${b.pct}%`, cx, cy);
    cx += ctx.measureText(`${b.pct}%`).width + 16;
  });

  // bottom: url (left) + tagline (right)
  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle = pal.accent;
  ctx.textAlign = "left";
  ctx.fillText("ai.electionsbg.com/evals", PAD, H - 34);
  ctx.font = `500 24px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.textAlign = "right";
  ctx.fillText("отворен бенчмарк · отворен код", W - PAD, H - 36);

  writeFileSync(OUT, canvas.toBuffer("image/png"));
  console.error(`wrote ${OUT} (${headline}, ${bars.length} models)`);
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
