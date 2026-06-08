/**
 * Наясно AI — Facebook ad creatives.
 *
 * Two concepts × FB formats:
 *   A "Питай"        — Gemini-painted navy+coral bg + crisp Cyrillic hook   (1:1, 9:16)
 *   B "Колаж"        — the existing collage card (ai/assets/og.png) + tagline (1:1, 4:5)
 *
 * Hybrid pipeline (same as scripts/brand/generate_brand_art.ts): Gemini image
 * model paints the background, @napi-rs/canvas composites text (image models
 * mangle Cyrillic), sharp cover-crops to exact pixels.
 *
 * Run:  node_modules/.bin/tsx scripts/brand/generate_ads.ts
 * Model override: BRAND_IMAGE_MODEL=gemini-3-pro-image
 * Output: brand/ads/*.png  (committed dir, never deployed)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import sharp from "sharp";
import { FONT, THEME, drawWordmark } from "../posts/cardKit";

type Ctx = SKRSContext2D;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "../..");
const OUT = resolve(ROOT, "brand/ads");
const ENV_FILE = resolve(ROOT, ".env.local");
const MODEL = process.env.BRAND_IMAGE_MODEL || "gemini-3.1-flash-image";
const PAL = THEME.dark; // navy #0b1224 + coral #df6b43 accent

const loadGeminiEnv = (): void => {
  if (!existsSync(ENV_FILE)) return;
  for (const line of readFileSync(ENV_FILE, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
};

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

type ImgPart = {
  inlineData?: { data?: string };
  inline_data?: { data?: string };
};
type GeminiResp = { candidates?: { content?: { parts?: ImgPart[] } }[] };

const geminiImage = async (
  prompt: string,
  aspect: string,
): Promise<Buffer | null> => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set (check .env.local)");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const attempts: Record<string, unknown>[] = [
    { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } },
    { responseModalities: ["IMAGE"] },
  ];
  for (const generationConfig of attempts) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig,
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) {
        console.warn(
          `  gemini ${res.status}: ${(await res.text()).slice(0, 140)}`,
        );
        continue;
      }
      const json = (await res.json()) as GeminiResp;
      const part = (json?.candidates?.[0]?.content?.parts ?? []).find(
        (p) => p?.inlineData?.data || p?.inline_data?.data,
      );
      const b64 = part?.inlineData?.data ?? part?.inline_data?.data;
      if (b64) return Buffer.from(b64, "base64");
    } catch (e) {
      console.warn(`  gemini error: ${(e as Error).message}`);
    }
  }
  return null;
};

const AD_BG_PROMPT =
  "Premium abstract background for a Bulgarian civic-data AI product advert. Deep navy (#0b1224) to near-black gradient with a warm coral (#df6b43) glow and subtle luminous data motifs — faint thin lines and small glowing dots forming a sparse network/constellation, evoking artificial intelligence reading official public data. Sophisticated, minimal, lots of clean empty space for large text overlay. Absolutely NO text, NO letters, NO numbers, NO logos, NO faces, NO flags. Avoid bright blue and red (no political party colours). High quality, cinematic depth.";

// Concept A — Gemini bg + the "ask Наясно AI" hook. Text sizes key off WIDTH
// (constant 1080) so they don't overflow; vertical positions key off HEIGHT.
const buildAskAd = async (name: string, w: number, h: number) => {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d") as unknown as Ctx;
  console.log(`[${name}] Gemini bg (${MODEL})…`);
  const bg = await geminiImage(AD_BG_PROMPT, w === h ? "1:1" : "9:16");
  if (bg) {
    const fitted = await sharp(bg)
      .resize(w, h, { fit: "cover", position: "attention" })
      .png()
      .toBuffer();
    ctx.drawImage(await loadImage(fitted), 0, 0, w, h);
  } else {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#070b16");
    g.addColorStop(1, PAL.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  // left scrim for legibility
  const scrim = ctx.createLinearGradient(0, 0, w, 0);
  scrim.addColorStop(0, "rgba(5,8,15,0.92)");
  scrim.addColorStop(0.6, "rgba(5,8,15,0.55)");
  scrim.addColorStop(1, "rgba(5,8,15,0.15)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, w, h);

  const x = 90;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // kicker
  ctx.fillStyle = PAL.accent;
  ctx.font = `700 ${Math.round(w * 0.026)}px ${FONT}`;
  ctx.fillText("БЕЗПЛАТЕН AI АСИСТЕНТ", x, h * 0.13);

  // wordmark "наясно" + coral " AI"
  const wm = Math.round(w * 0.06);
  drawWordmark(ctx, x, h * 0.22, wm, PAL);
  ctx.font = `800 ${wm}px ${FONT}`;
  ctx.fillStyle = PAL.accent;
  ctx.fillText(" AI", x + ctx.measureText("наясно").width, h * 0.22);

  // headline
  const hs = Math.round(w * 0.075);
  ctx.fillStyle = PAL.text;
  let hy = h * 0.42;
  for (const line of ["Питай за изборите,", "парите и властта."]) {
    ctx.font = `800 ${hs}px ${FONT}`;
    ctx.fillText(line, x, hy);
    hy += hs * 1.12;
  }

  // subtext
  const ss = Math.round(w * 0.032);
  ctx.fillStyle = PAL.muted;
  let sy = hy + h * 0.015;
  for (const line of ["Отговор от официалните", "данни — не от мнения."]) {
    ctx.font = `500 ${ss}px ${FONT}`;
    ctx.fillText(line, x, sy);
    sy += ss * 1.3;
  }

  // CTA pill (coral fill, navy text)
  const cta = "Пробвай · ai.electionsbg.com";
  const cs = Math.round(w * 0.028);
  ctx.font = `700 ${cs}px ${FONT}`;
  const tw = ctx.measureText(cta).width;
  const padX = cs * 0.9;
  const padY = cs * 0.7;
  const pillH = cs + padY * 2;
  const pillY = h * 0.85;
  ctx.fillStyle = PAL.accent;
  roundRect(ctx, x, pillY, tw + padX * 2, pillH, pillH / 2);
  ctx.fill();
  ctx.fillStyle = PAL.bg;
  ctx.textBaseline = "middle";
  ctx.fillText(cta, x + padX, pillY + pillH / 2);

  writeFileSync(resolve(OUT, `${name}.png`), canvas.toBuffer("image/png"));
  console.log(`[${name}] -> brand/ads/${name}.png (${w}x${h})`);
};

// Concept B — the existing collage card as the hero + a tagline panel below.
const buildCollageAd = async (name: string, w: number, h: number) => {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d") as unknown as Ctx;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#070b16");
  g.addColorStop(1, PAL.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const og = await loadImage(resolve(ROOT, "ai/assets/og.png"));
  const ogH = Math.round((w * og.height) / og.width);
  ctx.drawImage(og, 0, 0, w, ogH);

  const cx = w / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // coral rule
  ctx.fillStyle = PAL.accent;
  roundRect(ctx, cx - w * 0.09, ogH + (h - ogH) * 0.16, w * 0.18, 6, 3);
  ctx.fill();

  // headline (uppercase tagline)
  const hs = Math.round(w * 0.078);
  ctx.fillStyle = PAL.text;
  let hy = ogH + (h - ogH) * 0.36;
  for (const line of ["ФАКТИ ЗА ВЛАСТТА", "И ПАРИТЕ"]) {
    ctx.font = `800 ${hs}px ${FONT}`;
    ctx.fillText(line, cx, hy);
    hy += hs * 1.1;
  }

  // subtext
  const ss = Math.round(w * 0.034);
  ctx.fillStyle = PAL.muted;
  let sy = hy + h * 0.012;
  for (const line of ["Поръчки, бюджет, декларации —", "на разговорен език."]) {
    ctx.font = `500 ${ss}px ${FONT}`;
    ctx.fillText(line, cx, sy);
    sy += ss * 1.3;
  }

  // footer url
  ctx.fillStyle = PAL.accent;
  ctx.font = `700 ${Math.round(w * 0.03)}px ${FONT}`;
  ctx.fillText("ai.electionsbg.com · безплатно", cx, sy + h * 0.02);

  writeFileSync(resolve(OUT, `${name}.png`), canvas.toBuffer("image/png"));
  console.log(`[${name}] -> brand/ads/${name}.png (${w}x${h})`);
};

const main = async () => {
  loadGeminiEnv();
  mkdirSync(OUT, { recursive: true });
  console.log(`Model: ${MODEL}\nOut:   ${OUT}\n`);
  await buildAskAd("ad_a_ask_1080x1080", 1080, 1080);
  await buildAskAd("ad_a_ask_1080x1920", 1080, 1920);
  await buildCollageAd("ad_b_collage_1080x1080", 1080, 1080);
  await buildCollageAd("ad_b_collage_1080x1350", 1080, 1350);
  console.log("\nDone. Review brand/ads/ and re-run to iterate.");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
