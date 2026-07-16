// Dedicated og:image capture for /sector/transport — a MAP-focused card (the infrastructure
// map — funded rail sections as lines + ports/stations as points — is the sector's signature
// visual, and reads far better than the generic KPI clip). Framed on the map at all-time
// scope; captured at 1× and palette-quantised so the
// map raster doesn't balloon the PNG (the flat-UI sectors are ~200 KB — a 2× map is ~2.3 MB).
//
// Transport is therefore EXCLUDED from the bulk scripts/og/screenshot_sectors.ts loop so a
// bulk re-run can't clobber this hand-framed capture. Output: public/og/sector-transport.png
// (referenced by SECTOR_PAGES in scripts/prerender/routes.ts).
//
// Run with the dev server up (needs /api/db for the map + KPIs):
//   npm run dev    # another shell
//   npx tsx scripts/og/screenshot_transport.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../..", "public/og/sector-transport.png");
const BASE = process.env.OG_BASE_URL ?? "http://localhost:5173";

const run = async (): Promise<void> => {
  const browser = await chromium.launch();
  try {
    // deviceScaleFactor 1 → native 1200×630 (the OG display size); social cards downscale
    // anyway, and a 2× map raster is ~10× the file size for no visible gain.
    const context = await browser.newContext({
      viewport: { width: 1200, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const url = `${BASE}/sector/transport?elections=2026_04_19&pscope=all`;
    console.log(`→ ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 40_000 });
    // Fail loudly if the map never rendered — a silent miss would capture the top promo
    // banner instead of the map. The map card + ≥1 loaded basemap tile are the gate.
    await page.waitForSelector(
      '[data-og="transport-project-map"] .leaflet-container',
      {
        timeout: 25_000,
      },
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".leaflet-tile-loaded").length >= 4,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(2000);
    // Frame the facility-map card just under the sticky site header.
    const scrolled = await page.evaluate(() => {
      const card = document.querySelector('[data-og="transport-project-map"]');
      const header = document.querySelector("header");
      const headH = header ? (header as HTMLElement).offsetHeight : 60;
      if (!card) return false;
      window.scrollTo(
        0,
        (card as HTMLElement).getBoundingClientRect().top +
          window.scrollY -
          headH -
          6,
      );
      return true;
    });
    if (!scrolled)
      throw new Error("map card not found — aborting (no bad OG written)");
    await page.waitForTimeout(700);
    const raw = await page.screenshot({
      clip: { x: 0, y: 0, width: 1200, height: 630 },
    });
    // Palette-quantise so the map OG is size-comparable to the flat-UI sectors.
    const buf = await sharp(raw)
      .png({ palette: true, quality: 90, effort: 9, compressionLevel: 9 })
      .toBuffer();
    fs.writeFileSync(OUT, buf);
    console.log(
      `  ✓ sector-transport.png (${Math.round(buf.length / 1024)} KB)`,
    );
  } finally {
    await browser.close();
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
