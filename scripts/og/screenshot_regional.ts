// Dedicated og:image capture for /sector/regional — a MAP-focused card.
//
// The generic KPI clip (scripts/og/screenshot_sectors.ts) frames the top of the dashboard,
// which for regional is the site header + breadcrumb + scope pills + the pass-through hero's
// text — no chart, no map, and half the card spent on chrome. The sector's signature visual
// is the per-oblast ИСУН choropleth ("Стигат ли парите до най-бедните области?") with the
// convergence scatter beneath it, so this frames those instead.
//
// Regional is therefore EXCLUDED from the bulk screenshot_sectors.ts loop so a bulk re-run
// can't clobber this hand-framed capture — same arrangement as transport.
//
// Unlike transport (Leaflet raster → 1× + quantise to keep the PNG small), this choropleth
// is inline d3 SVG, so 2× costs little and keeps the text crisp.
//
// Run with the dev server up (needs /api/db for the fund-payload muni map):
//   npm run dev    # another shell
//   npx tsx scripts/og/screenshot_regional.ts
// Point at a non-default dev port with OG_BASE_URL=http://localhost:5174.
//
// Output: public/og/sector-regional.png (referenced by SECTOR_PAGES in
// scripts/prerender/routes.ts).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../..", "public/og/sector-regional.png");
const BASE = process.env.OG_BASE_URL ?? "http://localhost:5173";

// The 28 oblast polygons. A partial render (geometry in, values still loading) would
// capture a grey map, so gate on most of them being present.
const MIN_OBLAST_PATHS = 20;
// Map height that makes the card land near the 1200×630 OG aspect, so composing it onto
// the canvas needs almost no padding.
const MAP_HEIGHT = 430;
const OG_W = 1200;
const OG_H = 630;

const run = async (): Promise<void> => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    // pscope=all — the card should show the whole corpus, not one parliament's window.
    const url = `${BASE}/sector/regional?elections=2026_04_19&pscope=all`;
    console.log(`→ ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 40_000 });

    // Fail loudly if the map never rendered — a silent miss would frame the promo banner.
    await page.waitForSelector('[data-og="regional-oblast-map"] svg path', {
      timeout: 25_000,
    });
    await page.waitForFunction(
      (min) =>
        document.querySelectorAll('[data-og="regional-oblast-map"] svg path')
          .length >= min,
      MIN_OBLAST_PATHS,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(1500);

    // Grow the map. Its responsive height class tops out at 260px — sized for a tile in a
    // scrolling page, which leaves an OG-sized card mostly whitespace.
    //
    // Pick the map by PATH COUNT, not `card.querySelector("svg")`: the card's first svg is
    // the lucide icon in the CardTitle, and resizing THAT stretches the header instead.
    const grew = await page.evaluate((h) => {
      const card = document.querySelector('[data-og="regional-oblast-map"]');
      if (!card) return false;
      const svg = [...card.querySelectorAll("svg")].sort(
        (a, b) =>
          b.querySelectorAll("path").length - a.querySelectorAll("path").length,
      )[0];
      const box = svg?.parentElement;
      if (!box) return false;
      (box as HTMLElement).style.height = `${h}px`;
      return true;
    }, MAP_HEIGHT);
    if (!grew) throw new Error("could not resize the choropleth");
    // The map re-projects on resize (useLayoutEffect measures the box).
    await page.waitForTimeout(1200);

    // Capture the CARD ITSELF rather than a viewport clip. There is no sticky header on this
    // app and no scroll container to anchor to, so a scroll-then-clip depends on layout luck;
    // an element screenshot is deterministic.
    const card = await page.$('[data-og="regional-oblast-map"]');
    if (!card) throw new Error("regional-oblast-map card not found");
    const shot = await card.screenshot();

    // Compose onto an exact 1200×630 OG canvas, matched to the page background so the
    // padding is invisible.
    const bg = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    await sharp(shot)
      .resize(OG_W * 2, OG_H * 2, {
        fit: "contain",
        background: bg,
        withoutEnlargement: false,
      })
      .png()
      .toFile(OUT);
    console.log(
      `  ✓ sector-regional.png (${Math.round(fs.statSync(OUT).size / 1024)} KB)`,
    );
  } finally {
    await browser.close();
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
