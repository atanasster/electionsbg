/**
 * Наясно — brand artwork generator.
 *
 * Hybrid pipeline: Google Gemini image model paints the atmospheric
 * background (it is great at texture/light, terrible at Cyrillic text),
 * then @napi-rs/canvas composites the crisp wordmark + taglines on top.
 * sharp cover-crops the Gemini output to exact Facebook dimensions.
 *
 * Auth pattern copied from scripts/council/lib/gemini_ocr.ts:
 *   .env.local -> GEMINI_API_KEY (OVERWRITES any stale shell value).
 *
 * Models (override with BRAND_IMAGE_MODEL):
 *   gemini-3.1-flash-image  (flash 3.1, default — fast/cheap)
 *   gemini-3-pro-image      (pro 3.0 — higher fidelity)
 *
 * Run:
 *   node_modules/.bin/tsx scripts/brand/generate_brand_art.ts
 *   BRAND_IMAGE_MODEL=gemini-3-pro-image node_modules/.bin/tsx scripts/brand/generate_brand_art.ts
 *
 * Output: brand/*.png
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(PROJECT_ROOT, "brand");
const ENV_FILE = resolve(PROJECT_ROOT, ".env.local");
const MODEL = process.env.BRAND_IMAGE_MODEL || "gemini-3.1-flash-image";

const loadGeminiEnv = (): void => {
  if (!existsSync(ENV_FILE)) return;
  for (const line of readFileSync(ENV_FILE, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
};

// ---- brand tokens — reused from the site theme (src/index.css):
// dark navy --background + coral-peach --accent (the site's signature accent).
const INK = "#0b1224"; // site dark --background (#0B1224 deep navy)
const INK2 = "#070b16";
const CORAL = "#df6b43"; // site --accent (coral peach #DF6B43)
const WHITE = "#f2f5f8"; // site dark --foreground
const MUTED = "#9aa7bd"; // site dark --muted-foreground
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

/** Wordmark "наясно" — white, with an amber highlighter swipe under the
 *  "ясно" half (the на+ясно = "into clarity" pun). */
const drawWordmark = (
  ctx: Ctx,
  x: number,
  baseline: number,
  size: number,
  align: "left" | "center" = "left",
) => {
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const word = "наясно";
  const naW = ctx.measureText("на").width;
  const yasnoW = ctx.measureText("ясно").width;
  const totalW = ctx.measureText(word).width;
  const startX = align === "center" ? x - totalW / 2 : x;
  // amber swipe under the "ясно" portion
  ctx.fillStyle = CORAL;
  roundRect(
    ctx,
    startX + naW - size * 0.03,
    baseline + size * 0.08,
    yasnoW + size * 0.06,
    size * 0.17,
    size * 0.06,
  );
  ctx.fill();
  ctx.fillStyle = WHITE;
  ctx.fillText(word, startX, baseline);
  return { startX, totalW };
};

const proceduralBg = (ctx: Ctx, w: number, h: number) => {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, INK2);
  g.addColorStop(1, INK);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // sparse data dots
  for (let i = 0; i < 220; i++) {
    const px = (i * 73.13) % w;
    const py = (i * 129.7) % h;
    ctx.globalAlpha = 0.05 + ((i * 7) % 10) / 60;
    ctx.fillStyle = i % 9 === 0 ? CORAL : "#8fa0bf";
    ctx.beginPath();
    ctx.arc(px, py, i % 9 === 0 ? 3 : 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // amber glow bottom-right
  const rg = ctx.createRadialGradient(
    w * 0.86,
    h * 0.9,
    0,
    w * 0.86,
    h * 0.9,
    w * 0.5,
  );
  rg.addColorStop(0, "rgba(223,107,67,0.32)");
  rg.addColorStop(1, "rgba(223,107,67,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, w, h);
};

type GenConfig = Record<string, unknown>;
type ImgPart = {
  inlineData?: { data?: string };
  inline_data?: { data?: string };
};
type GeminiImageResponse = {
  candidates?: { content?: { parts?: ImgPart[] } }[];
};
const geminiImage = async (
  prompt: string,
  aspect: string,
): Promise<Buffer | null> => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set (check .env.local)");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const attempts: GenConfig[] = [
    { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } },
    { responseModalities: ["IMAGE"] },
    {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: aspect },
    },
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
          `  gemini ${res.status}: ${(await res.text()).slice(0, 160)}`,
        );
        continue;
      }
      const json = (await res.json()) as GeminiImageResponse;
      const parts = json?.candidates?.[0]?.content?.parts ?? [];
      const part = parts.find(
        (p) => p?.inlineData?.data || p?.inline_data?.data,
      );
      const b64 = part?.inlineData?.data ?? part?.inline_data?.data;
      if (b64) return Buffer.from(b64, "base64");
      console.warn(`  no image part (cfg ${JSON.stringify(generationConfig)})`);
    } catch (e) {
      console.warn(`  gemini error: ${(e as Error).message}`);
    }
  }
  return null;
};

const buildCover = async (
  name: string,
  w: number,
  h: number,
  prompt: string,
  paint: (ctx: Ctx) => void,
) => {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d") as unknown as Ctx;
  console.log(`[${name}] requesting Gemini background (${MODEL})…`);
  const bg = await geminiImage(prompt, w > h ? "16:9" : "1:1");
  if (bg) {
    writeFileSync(resolve(OUT_DIR, `_raw_${name}.png`), bg);
    const fitted = await sharp(bg)
      .resize(w, h, { fit: "cover", position: "attention" })
      .png()
      .toBuffer();
    const img = await loadImage(fitted);
    ctx.drawImage(img, 0, 0, w, h);
    console.log(`[${name}] Gemini bg OK`);
  } else {
    console.log(`[${name}] Gemini unavailable → procedural background`);
    proceduralBg(ctx, w, h);
  }
  // left→right charcoal scrim for legible text
  const scrim = ctx.createLinearGradient(0, 0, w, 0);
  scrim.addColorStop(0, "rgba(5,8,15,0.94)");
  scrim.addColorStop(0.5, "rgba(5,8,15,0.6)");
  scrim.addColorStop(1, "rgba(5,8,15,0.12)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, w, h);
  paint(ctx);
  const buf = canvas.toBuffer("image/png");
  writeFileSync(resolve(OUT_DIR, `${name}.png`), buf);
  console.log(`[${name}] -> brand/${name}.png (${w}x${h})`);
};

const buildProfile = () => {
  const S = 1080;
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext("2d") as unknown as Ctx;
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, INK2);
  g.addColorStop(1, INK);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // faint dot grid
  ctx.fillStyle = "rgba(143,160,191,0.10)";
  for (let yy = 120; yy < S; yy += 70)
    for (let xx = 120; xx < S; xx += 70) {
      ctx.beginPath();
      ctx.arc(xx, yy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  drawWordmark(ctx, S / 2, S / 2 + 60, 188, "center");
  // small kicker
  ctx.fillStyle = MUTED;
  ctx.font = `600 38px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("ДАННИ ЗА БЪЛГАРИЯ", S / 2, S / 2 + 150);
  writeFileSync(
    resolve(OUT_DIR, "profile_1080.png"),
    canvas.toBuffer("image/png"),
  );
  console.log("[profile] -> brand/profile_1080.png (1080x1080)");
};

const buildShareCard = () => {
  const W = 1080;
  const Hh = 1080;
  const canvas = createCanvas(W, Hh);
  const ctx = canvas.getContext("2d") as unknown as Ctx;
  const g = ctx.createLinearGradient(0, 0, 0, Hh);
  g.addColorStop(0, INK2);
  g.addColorStop(1, INK);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, Hh);
  // top wordmark
  drawWordmark(ctx, 80, 150, 64, "left");
  // big number
  ctx.fillStyle = CORAL;
  ctx.font = `800 220px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("2,4", 80, 560);
  ctx.fillStyle = WHITE;
  ctx.font = `800 110px ${FONT}`;
  ctx.fillText("млрд. лв.", 80, 690);
  // label
  ctx.fillStyle = "#e6eaf1";
  ctx.font = `600 46px ${FONT}`;
  ctx.fillText("обществени поръчки, възложени", 80, 790);
  ctx.fillText("без конкуренция през 2024 г.", 80, 850);
  // footer
  ctx.fillStyle = MUTED;
  ctx.font = `500 34px ${FONT}`;
  ctx.fillText("Източник: АОП", 80, 990);
  ctx.textAlign = "right";
  ctx.fillStyle = CORAL;
  ctx.fillText("виж разбивката", W - 120, 990);
  // amber play-triangle instead of a → glyph the fallback font lacks
  ctx.beginPath();
  ctx.moveTo(W - 104, 970);
  ctx.lineTo(W - 80, 985);
  ctx.lineTo(W - 104, 1000);
  ctx.closePath();
  ctx.fill();
  writeFileSync(
    resolve(OUT_DIR, "share_card_sample_1080.png"),
    canvas.toBuffer("image/png"),
  );
  console.log("[share] -> brand/share_card_sample_1080.png (1080x1080)");
};

const main = async () => {
  loadGeminiEnv();
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Model: ${MODEL}\nOut:   ${OUT_DIR}\n`);

  buildProfile();
  buildShareCard();

  await buildCover(
    "page_cover_1640x624",
    1640,
    624,
    "Wide cinematic abstract background for an independent Bulgarian civic-data and transparency brand. Deep navy-to-near-black gradient with warm coral light breaking through like dawn from the lower right. Subtle fine motifs of data and maps: faint thin grid lines and small luminous dots forming a sparse glowing network, evoking transparency and public information. Sophisticated, editorial, minimalist, generous empty negative space on the LEFT side for text overlay. Absolutely NO text, NO letters, NO numbers, NO flags, NO faces, NO logos. Avoid bright blue and red (no political party colours). High quality, photographic depth.",
    (ctx) => {
      ctx.fillStyle = CORAL;
      ctx.font = `700 26px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("НЕЗАВИСИМИ ДАННИ ЗА БЪЛГАРИЯ", 90, 150);
      drawWordmark(ctx, 90, 320, 150, "left");
      ctx.fillStyle = "#e6eaf1";
      ctx.font = `500 40px ${FONT}`;
      ctx.fillText("Изборите, парите и властта — на ясно.", 90, 410);
      ctx.fillStyle = MUTED;
      ctx.font = `600 30px ${FONT}`;
      ctx.fillText("Без мнения. Само данни.", 90, 470);
    },
  );

  await buildCover(
    "group_cover_1640x856",
    1640,
    856,
    "Wide cinematic abstract background for an online community about Bulgarian public data and accountability. Deep navy-to-near-black gradient with a warm coral glow, and a sparse network of glowing dots connected by thin faint lines, evoking citizens connected by shared data and a constellation/map. Sophisticated, editorial, minimalist, lots of empty negative space on the LEFT for text overlay. Absolutely NO text, NO letters, NO numbers, NO flags, NO faces, NO logos. Avoid bright blue and red (no political party colours). High quality.",
    (ctx) => {
      drawWordmark(ctx, 90, 360, 150, "left");
      ctx.fillStyle = "#e6eaf1";
      ctx.font = `700 46px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("данните за България", 96, 430);
      ctx.fillStyle = MUTED;
      ctx.font = `500 38px ${FONT}`;
      ctx.fillText("Тук споровете се решават с данни, не с мнения.", 90, 520);
      ctx.fillStyle = CORAL;
      ctx.font = `700 34px ${FONT}`;
      ctx.fillText("Питай. Провери. Сподели.", 90, 590);
    },
  );

  console.log("\nDone. Review brand/ and re-run to iterate.");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
