/**
 * Наясно — per-platform channel artwork.
 *
 * Emits every avatar and banner needed to open the seven reserved channels
 * (YouTube, TikTok, Instagram, LinkedIn, X, Pinterest, Telegram) at each
 * platform's own dimensions, from the shared mark in lib/brandMark.ts.
 *
 * Purely procedural — no Gemini call, no API key, no network. Unlike
 * generate_brand_art.ts (which paints a Gemini background for the Facebook
 * covers), these are flat brand surfaces where a generated texture would only
 * add noise behind a wordmark.
 *
 * Run:
 *   npm run brand:channels
 *
 * Output: brand/channels/*.png + index.json
 *
 * ⚠️ Two rules the platforms enforce and a naive render breaks:
 *
 * 1. EVERY avatar is circle-cropped. Content must sit inside the inscribed
 *    circle, not the square — anything in a corner is gone.
 * 2. Banners have SAFE ZONES far smaller than the image. YouTube shows only a
 *    centred 1235x338 of its 2560x1440 on a phone; X puts the avatar over the
 *    lower left of the header; LinkedIn puts the page logo over the left of
 *    the cover. Text outside those areas is cropped or covered on the surface
 *    where most people see it.
 */
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CORAL,
  MUTED,
  PROJECT_ROOT,
  FONT,
  dotGridBg,
  drawMonogram,
  drawWordmark,
  proceduralBg,
  registerFonts,
} from "./lib/brandMark.js";

type Ctx = SKRSContext2D;

const OUT_DIR = resolve(PROJECT_ROOT, "brand/channels");

const TAGLINE = "Бъди наясно.";
const KICKER = "ИЗБОРИТЕ, ПАРИТЕ И ВЛАСТТА — С ОТВОРЕНИ ДАННИ";

type Emitted = {
  file: string;
  platform: string;
  slot: string;
  w: number;
  h: number;
  note: string;
};
const emitted: Emitted[] = [];

const save = (
  canvas: Canvas,
  file: string,
  platform: string,
  slot: string,
  note: string,
) => {
  writeFileSync(resolve(OUT_DIR, file), canvas.toBuffer("image/png"));
  emitted.push({
    file,
    platform,
    slot,
    w: canvas.width,
    h: canvas.height,
    note,
  });
  console.log(
    `  ${file.padEnd(34)} ${String(canvas.width).padStart(4)}x${String(canvas.height).padEnd(4)}  ${platform} — ${slot}`,
  );
};

/**
 * Avatar. `kind: "monogram"` is the default and the one to actually upload:
 * "на" survives the 32-100px at which avatars are really seen.
 * `kind: "wordmark"` matches the existing Facebook profile picture, for
 * whoever prefers cross-channel sameness over legibility.
 */
const avatar = (size: number, kind: "monogram" | "wordmark") => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d") as unknown as Ctx;
  dotGridBg(ctx, size, size, Math.round(size / 15));

  // Everything inside the inscribed circle — the platforms all crop to it.
  if (kind === "monogram") {
    drawMonogram(ctx, size / 2, size / 2, size * 0.46);
  } else {
    drawWordmark(
      ctx,
      size / 2,
      size / 2 + size * 0.055,
      size * 0.174,
      "center",
    );
    ctx.fillStyle = MUTED;
    ctx.font = `600 ${size * 0.035}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("ДАННИ ЗА БЪЛГАРИЯ", size / 2, size / 2 + size * 0.139);
  }
  return canvas;
};

/**
 * Banner. Content is laid out inside (safeW x safeH) centred on
 * (safeCx, safeCy) — every platform's own visible window — while the
 * background texture runs to the full bleed.
 */
const banner = (
  w: number,
  h: number,
  safe: { cx: number; cy: number; w: number; h: number },
  opts: { tagline?: boolean; kicker?: boolean } = {},
) => {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d") as unknown as Ctx;
  proceduralBg(ctx, w, h);

  const tagline = opts.tagline ?? true;
  const kicker = opts.kicker ?? true;

  // The text block is laid out in units of markSize and then SIZED TO FIT the
  // safe rect, rather than picked and hoped for. Getting this backwards put
  // YouTube's tagline 24px and its kicker 84px below the 1235x338 window — i.e.
  // invisible on a phone, which is where the channel is actually seen.
  const ASCENT = 0.78; // top of the glyph to its baseline
  const SWIPE = 0.25; // baseline to the bottom of the coral swipe
  const TAG_GAP = 0.42;
  const KICK_GAP = 0.3;
  const DESCEND = 0.05;
  const units =
    ASCENT +
    SWIPE +
    (tagline ? TAG_GAP : 0) +
    (kicker ? KICK_GAP : 0) +
    DESCEND;

  const markSize = Math.min(safe.h / units, safe.w * 0.19);
  const blockTop = safe.cy - (markSize * units) / 2;

  const baseline = blockTop + markSize * ASCENT;
  drawWordmark(ctx, safe.cx, baseline, markSize, "center");

  let y = baseline + markSize * SWIPE;
  if (tagline) {
    y += markSize * TAG_GAP;
    ctx.fillStyle = CORAL;
    ctx.font = `700 ${markSize * 0.28}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(TAGLINE, safe.cx, y);
  }
  if (kicker) {
    y += markSize * KICK_GAP;
    ctx.fillStyle = MUTED;
    ctx.font = `600 ${markSize * 0.17}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(KICKER, safe.cx, y);
  }

  // Assert the block landed inside the window it was sized for.
  const bottom = y + markSize * DESCEND;
  const safeBottom = safe.cy + safe.h / 2;
  if (bottom > safeBottom + 0.5) {
    throw new Error(
      `banner ${w}x${h}: content overflows the safe area by ${(bottom - safeBottom).toFixed(1)}px`,
    );
  }
  return canvas;
};

const main = () => {
  registerFonts();
  mkdirSync(OUT_DIR, { recursive: true });
  console.log("[channels] writing brand/channels/");

  // ---- Avatars. One monogram per platform at that platform's upload size,
  // plus the wordmark alternative at a single generous size.
  const AVATARS: [string, number, string, string][] = [
    ["youtube", 800, "YouTube", "channel picture (displays 98px)"],
    ["tiktok", 800, "TikTok", "profile photo (displays 200px)"],
    ["instagram", 1080, "Instagram", "profile photo (displays 320px)"],
    ["linkedin", 400, "LinkedIn", "page logo (min 300x300)"],
    ["x", 400, "X", "profile photo"],
    ["pinterest", 800, "Pinterest", "profile photo (displays 165px)"],
    ["telegram", 1280, "Telegram", "channel photo"],
  ];
  for (const [slug, size, platform, note] of AVATARS) {
    save(
      avatar(size, "monogram"),
      `avatar_${slug}_${size}.png`,
      platform,
      "avatar",
      note,
    );
  }
  save(
    avatar(1080, "wordmark"),
    "avatar_wordmark_1080.png",
    "any",
    "avatar (alt)",
    "wordmark variant — matches the current Facebook profile picture",
  );

  // ---- Banners.
  // YouTube: 2560x1440 bleed, but only a centred 1235x338 is visible on a
  // phone. That window is the whole design; the rest is bleed for TV.
  save(
    banner(2560, 1440, { cx: 1280, cy: 720, w: 1235, h: 338 }),
    "banner_youtube_2560x1440.png",
    "YouTube",
    "channel banner",
    "safe area 1235x338 centred — everything readable is inside it",
  );
  // X: 1500x500, the avatar sits over the lower left, so content goes
  // upper-centre.
  save(
    banner(1500, 500, { cx: 780, cy: 205, w: 1100, h: 300 }),
    "banner_x_1500x500.png",
    "X",
    "header",
    "content upper-centre — the avatar overlaps the lower left",
  );
  // LinkedIn: 1128x191 is a letterbox and the page logo covers the left
  // ~220px. No kicker — there is no room for a third line.
  save(
    banner(1128, 191, { cx: 690, cy: 96, w: 800, h: 150 }, { kicker: false }),
    "banner_linkedin_1128x191.png",
    "LinkedIn",
    "page cover",
    "content right of centre — the page logo covers the left ~220px",
  );

  writeFileSync(
    resolve(OUT_DIR, "index.json"),
    JSON.stringify(emitted, null, 2) + "\n",
  );
  console.log(`[channels] ${emitted.length} files + index.json`);
};

main();
