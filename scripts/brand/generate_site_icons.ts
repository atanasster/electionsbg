/**
 * Наясно — the site's own icons and default share card.
 *
 * Everything here derives from `lib/brandMark.ts`, the same module the social
 * channel art uses, so the favicon in a browser tab and the avatar on YouTube
 * are the same mark rather than two drawings that drifted.
 *
 * Run:
 *   npm run brand:icons
 *
 * ## What it replaces
 *
 * The previous set was the electionsBG mark — a coral ballot checkmark on brown
 * with a Bulgarian flag stripe — hand-cut from `icon-source-*.svg` and last
 * touched in April. It survived the rename because nothing generated it and no
 * gate mentioned it: a favicon is the one brand surface that never appears in a
 * diff.
 *
 * ⚠️ The flag stripe is deliberately NOT carried over. It is a real loss — it
 * signalled "Bulgarian" at a glance — but the brand system that is already live
 * on five social profiles is navy + coral + the "на" monogram, and a favicon
 * that does not match the avatar beside it in a share preview is a worse trade
 * than losing the stripe.
 *
 * ## The 16px problem, stated rather than hidden
 *
 * Two Cyrillic letters at 16px are marginal. They are kept anyway, because the
 * alternatives are worse: a single "н" is H-shaped and names no brand (see
 * drawMonogram's header), and an abstract mark would match nothing else the
 * project ships. Most tabs render the 32px asset on a retina display, where it
 * reads cleanly.
 */
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import {
  CORAL,
  INK,
  INK2,
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
const PUB = resolve(PROJECT_ROOT, "public");

/** Square brand tile. `inset` shrinks the mark for maskable safe zones. */
const tile = (size: number, inset = 1): Canvas => {
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d") as unknown as Ctx;
  dotGridBg(ctx, size, size, Math.max(8, Math.round(size / 6)));
  drawMonogram(ctx, size / 2, size / 2, size * 0.46 * inset);
  return c;
};

/**
 * Minimal PNG-in-ICO container. Every browser in use reads PNG payloads inside
 * an .ico, and it saves a dependency for ~20 lines of well-specified header.
 */
const ico = (pngs: { size: number; buf: Buffer }[]): Buffer => {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach((p, i) => {
    const o = i * 16;
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, o); // 0 means 256
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, o + 1);
    dir.writeUInt8(0, o + 2); // palette
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bpp
    dir.writeUInt32LE(p.buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += p.buf.length;
  });
  return Buffer.concat([head, dir, ...pngs.map((p) => p.buf)]);
};

/** The site-wide share card — what a link with no card of its own gets. */
const shareCard = (): Canvas => {
  const W = 1200,
    H = 630;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d") as unknown as Ctx;
  proceduralBg(ctx, W, H);
  drawWordmark(ctx, W / 2, H / 2 - 10, 150, "center");
  ctx.fillStyle = CORAL;
  ctx.font = `700 42px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Бъди наясно.", W / 2, H / 2 + 78);
  ctx.fillStyle = MUTED;
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText(
    "ИЗБОРИТЕ, ПАРИТЕ И ВЛАСТТА — С ОТВОРЕНИ ДАННИ",
    W / 2,
    H / 2 + 132,
  );
  return c;
};

/** The SVG favicon. Letterforms are <text>, so this is an APPROXIMATION of the
 *  canvas-rendered PNGs — a viewer without Inter gets its own bold sans. The
 *  navy field and coral swipe are what carry recognition at this size. */
const faviconSvg = (rounded: boolean): string => {
  const r = rounded ? 14 : 0;
  const pad = rounded ? 4 : 0;
  const s = 64 - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Наясно">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${INK2}"/>
      <stop offset="1" stop-color="${INK}"/>
    </linearGradient>
  </defs>
  <rect x="${pad}" y="${pad}" width="${s}" height="${s}" rx="${r}" fill="url(#bg)"/>
  <text x="32" y="38" text-anchor="middle" fill="#f2f5f8"
        font-family="Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        font-size="27" font-weight="800" letter-spacing="-0.5">на</text>
  <rect x="17" y="42" width="30" height="5" rx="2.5" fill="${CORAL}"/>
</svg>
`;
};

const main = async () => {
  registerFonts();
  mkdirSync(resolve(PUB, "images"), { recursive: true });
  const png = (c: Canvas) => c.toBuffer("image/png");
  const out: [string, Buffer][] = [];

  for (const [name, size] of [
    ["favicon-16x16.png", 16],
    ["favicon-32x32.png", 32],
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["apple-touch-icon.png", 180],
  ] as [string, number][])
    out.push([name, png(tile(size))]);

  // Maskable: a launcher may crop to a circle inscribed in the middle ~80%.
  out.push(["icon-512-maskable.png", png(tile(512, 0.72))]);

  out.push([
    "favicon.ico",
    ico([16, 32, 48].map((s) => ({ size: s, buf: png(tile(s)) }))),
  ]);

  for (const [n, b] of out) {
    writeFileSync(resolve(PUB, n), b);
    console.log(`  public/${n.padEnd(26)} ${b.length.toLocaleString()} b`);
  }

  writeFileSync(resolve(PUB, "favicon.svg"), faviconSvg(true));
  writeFileSync(resolve(PUB, "icon-source-fullbleed.svg"), faviconSvg(false));
  writeFileSync(resolve(PUB, "icon-source-maskable.svg"), faviconSvg(false));
  console.log("  public/favicon.svg + the two icon-source-*.svg masters");

  const webp = await sharp(png(shareCard())).webp({ quality: 88 }).toBuffer();
  writeFileSync(resolve(PUB, "images/og_image.webp"), webp);
  console.log(
    `  public/images/og_image.webp   ${webp.length.toLocaleString()} b (1200x630)`,
  );
};

void main();
