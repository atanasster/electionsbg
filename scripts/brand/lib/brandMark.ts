/**
 * Наясно brand mark — the ONE producer of the wordmark, the monogram, the
 * palette and the background textures. Imported by every generator under
 * scripts/brand/ so a brand tweak is a single edit rather than a sweep.
 *
 * Colours are the site theme's own (src/index.css): dark navy --background
 * plus the coral-peach --accent. Not amber, not party colours.
 *
 * ⚠️ Fonts are registered EXPLICITLY from public/fonts/. Do not rely on the
 * host having Inter: it does not. Measured on the dev Mac, `"Inter"`,
 * `sans-serif` and `"DejaVu Sans"` all returned an identical advance width
 * for "наясно" — i.e. every brand asset generated before this module existed
 * silently rendered in the system fallback, and would render differently on
 * any other machine. registerFonts() is what makes the output reproducible.
 */
import { GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname_ = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname_, "../../..");

// ---- brand tokens — reused from the site theme (src/index.css).
export const INK = "#0b1224"; // --background (deep navy)
export const INK2 = "#070b16";
export const CORAL = "#df6b43"; // --accent (coral peach)
export const WHITE = "#f2f5f8"; // dark --foreground
export const MUTED = "#9aa7bd"; // dark --muted-foreground

export const FONT =
  '"Inter", system-ui, -apple-system, "Helvetica Neue", "Segoe UI", "Roboto", "DejaVu Sans", sans-serif';

type Ctx = SKRSContext2D;

let fontsReady = false;

/**
 * Register the self-hosted Inter woff2 subsets under the family name "Inter".
 *
 * The files are google-webfonts-helper subsets split by unicode-range, and the
 * Cyrillic range is served by ONE variable file across weights 400-700 — so
 * registering every Inter file under a single family is both correct and
 * necessary: the Latin and Cyrillic glyphs live in different files and the
 * wordmark needs Cyrillic while the EN taglines need Latin.
 *
 * Idempotent, and a no-op when public/fonts/ is absent (a checkout without the
 * font fetch) — the CSS stack above then degrades rather than throwing.
 */
export const registerFonts = (): void => {
  if (fontsReady) return;
  fontsReady = true;
  const dir = resolve(PROJECT_ROOT, "public/fonts");
  if (!existsSync(dir)) {
    console.warn(
      "[brandMark] public/fonts missing — falling back to a system font. " +
        "Run `node scripts/fonts/fetch-fonts.mjs` for reproducible output.",
    );
    return;
  }
  let n = 0;
  for (const f of readdirSync(dir)) {
    if (!f.startsWith("inter-") || !f.endsWith(".woff2")) continue;
    if (GlobalFonts.registerFromPath(resolve(dir, f), "Inter")) n++;
  }
  if (n === 0) console.warn("[brandMark] no Inter subsets registered");
};

export const roundRect = (
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

/**
 * Weight-safe bold. The registered Inter is a VARIABLE font and napi-rs canvas
 * does not drive its weight axis, so `800 …px Inter` renders at the default
 * weight. Stroking the glyphs with a hairline proportional to the size gives
 * the wordmark its intended heft on every host, rather than depending on
 * whether the machine happens to own a static Inter Black.
 */
const fillBold = (
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  size: number,
) => {
  ctx.fillText(text, x, y);
  ctx.lineWidth = size * 0.035;
  ctx.strokeStyle = ctx.fillStyle as string;
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
};

/**
 * The wordmark: "наясно" with a coral swipe under the "ясно" half — the name
 * is "на" + "ясно" ("into clarity"), and the swipe is what makes that legible
 * as a pun rather than a single word.
 */
export const drawWordmark = (
  ctx: Ctx,
  x: number,
  baseline: number,
  size: number,
  align: "left" | "center" = "left",
): { startX: number; totalW: number } => {
  registerFonts();
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const word = "наясно";
  const naW = ctx.measureText("на").width;
  const yasnoW = ctx.measureText("ясно").width;
  const totalW = ctx.measureText(word).width;
  const startX = align === "center" ? x - totalW / 2 : x;
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
  fillBold(ctx, word, startX, baseline, size);
  return { startX, totalW };
};

/**
 * The monogram: "на" over the coral swipe, for avatars.
 *
 * An avatar is rendered at 32-100px almost everywhere it matters (a comment
 * row, a subscriber list, a notification). Six Cyrillic letters at that size
 * are a smudge; a short mark and a coral bar still read.
 *
 * ⚠️ It is "на", not "н", and the reason is not aesthetic. Cyrillic lowercase
 * "н" is H-shaped, so a single-letter mark renders as something a reader of
 * either alphabet parses as a Latin "H" — a monogram that names no brand.
 * "на" carries the "а", which no Latin reading survives, and it is the first
 * half of the pun the wordmark is built on (на + ясно). Rendered and rejected
 * once; do not "simplify" it back.
 */
export const drawMonogram = (
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
): void => {
  registerFonts();
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const glyph = "на";
  const w = ctx.measureText(glyph).width;
  const baseline = cy + size * 0.34;
  const startX = cx - w / 2;
  ctx.fillStyle = CORAL;
  roundRect(
    ctx,
    startX - size * 0.06,
    baseline + size * 0.1,
    w + size * 0.12,
    size * 0.17,
    size * 0.06,
  );
  ctx.fill();
  ctx.fillStyle = WHITE;
  fillBold(ctx, glyph, startX, baseline, size);
};

/** Ambient background: navy gradient, sparse data dots, coral glow. */
export const proceduralBg = (ctx: Ctx, w: number, h: number): void => {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, INK2);
  g.addColorStop(1, INK);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
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

/** Flat navy gradient + faint dot grid — the calmer avatar background. */
export const dotGridBg = (ctx: Ctx, w: number, h: number, step = 70): void => {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, INK2);
  g.addColorStop(1, INK);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(143,160,191,0.10)";
  for (let yy = step; yy < h; yy += step)
    for (let xx = step; xx < w; xx += step) {
      ctx.beginPath();
      ctx.arc(xx, yy, Math.max(1.4, step / 35), 0, Math.PI * 2);
      ctx.fill();
    }
};
