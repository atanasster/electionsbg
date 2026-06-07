/**
 * Наясно AI — empty-state hero backdrop generator.
 *
 * Concept C: Gemini paints an atmospheric backdrop (it is great at texture/light,
 * terrible at charts/Cyrillic), and the React hero floats crisp mini answer-cards
 * on top. We render TWO variants so the backdrop matches the active theme:
 *   - light "corporate": warm cream/parchment + coral-peach glow
 *   - dark  "sunset":    deep navy + mint/teal-cyan glow
 *
 * Auth pattern copied from scripts/brand/generate_brand_art.ts:
 *   .env.local -> GEMINI_API_KEY (OVERWRITES any stale shell value).
 * If Gemini is unavailable, a procedural gradient is written so the build always
 * has both assets (the hero imports them statically).
 *
 * Run:  node_modules/.bin/tsx scripts/brand/generate_hero_art.ts
 * Out:  ai/assets/hero-bg-light.webp, ai/assets/hero-bg-dark.webp
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "ai/assets");
const ENV_FILE = resolve(ROOT, ".env.local");
const MODEL = process.env.BRAND_IMAGE_MODEL || "gemini-3.1-flash-image";

const W = 1600;
const H = 1000;

const loadGeminiEnv = (): void => {
  if (!existsSync(ENV_FILE)) return;
  for (const line of readFileSync(ENV_FILE, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
};

type ImgPart = {
  inlineData?: { data?: string };
  inline_data?: { data?: string };
};
type GeminiImageResponse = {
  candidates?: { content?: { parts?: ImgPart[] } }[];
};
const geminiImage = async (prompt: string): Promise<Buffer | null> => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.warn("  GEMINI_API_KEY not set — using procedural fallback");
    return null;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const attempts: Record<string, unknown>[] = [
    { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" } },
    { responseModalities: ["IMAGE"] },
    {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: "16:9" },
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

type Theme = {
  name: string;
  prompt: string;
  // procedural fallback palette
  c0: string;
  c1: string;
  glow: string;
  dot: string;
  accentDot: string;
};

const THEMES: Theme[] = [
  {
    name: "hero-bg-light",
    prompt:
      "Soft editorial abstract background in warm cream and parchment tones (#F1ECE0 base), with a gentle coral-peach glow (#DF6B43) diffusing from one corner like warm afternoon light. Subtle fine motifs of open data: faint thin grid lines and a sparse scatter of small soft dots forming a quiet luminous network, evoking transparency and public information. Calm, sophisticated, minimalist, lots of empty negative space, very low contrast, paper-like texture. Absolutely NO text, NO letters, NO numbers, NO charts, NO flags, NO faces, NO logos. Avoid bright blue and bright red. High quality, soft photographic depth.",
    c0: "#f4efe3",
    c1: "#e7dcc6",
    glow: "rgba(223,107,67,0.22)",
    dot: "rgba(120,110,90,0.18)",
    accentDot: "rgba(223,107,67,0.5)",
  },
  {
    name: "hero-bg-dark",
    prompt:
      "Cinematic abstract background, deep navy to near-black gradient (#0B1224 base), with a cool mint and teal-cyan glow (#7AE2C0) breaking through softly from one corner. Subtle fine motifs of data: faint thin grid lines and a sparse constellation of small luminous dots connected by thin faint lines, evoking transparency and a network of public information. Sophisticated, editorial, minimalist, lots of empty negative space, low contrast. Absolutely NO text, NO letters, NO numbers, NO charts, NO flags, NO faces, NO logos. Avoid bright blue and bright red (no political party colours). High quality, photographic depth.",
    c0: "#070b16",
    c1: "#0b1224",
    glow: "rgba(122,226,192,0.20)",
    dot: "rgba(143,160,191,0.16)",
    accentDot: "rgba(122,226,192,0.5)",
  },
];

const proceduralBg = (t: Theme): Buffer => {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as SKRSContext2D;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, t.c0);
  g.addColorStop(1, t.c1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 240; i++) {
    const px = (i * 97.3) % W;
    const py = (i * 151.7) % H;
    const accent = i % 8 === 0;
    ctx.fillStyle = accent ? t.accentDot : t.dot;
    ctx.beginPath();
    ctx.arc(px, py, accent ? 3 : 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const rg = ctx.createRadialGradient(
    W * 0.84,
    H * 0.18,
    0,
    W * 0.84,
    H * 0.18,
    W * 0.6,
  );
  rg.addColorStop(0, t.glow);
  rg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
  return canvas.toBuffer("image/png");
};

const main = async () => {
  loadGeminiEnv();
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Model: ${MODEL}\nOut:   ${OUT_DIR}\n`);
  for (const t of THEMES) {
    console.log(`[${t.name}] requesting Gemini background…`);
    const raw = (await geminiImage(t.prompt)) ?? proceduralBg(t);
    const webp = await sharp(raw)
      .resize(W, H, { fit: "cover", position: "attention" })
      .webp({ quality: 72 })
      .toBuffer();
    const dest = resolve(OUT_DIR, `${t.name}.webp`);
    writeFileSync(dest, webp);
    console.log(
      `[${t.name}] -> ${dest} (${(webp.length / 1024).toFixed(0)} KB)`,
    );
  }
  console.log("\nDone. Review ai/assets/hero-bg-*.webp and re-run to iterate.");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
