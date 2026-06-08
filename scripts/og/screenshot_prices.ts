// Take the og:image screenshot of the /prices explorer. Captures the live SPA
// at 1200x630 (the canonical og:image aspect ratio) and saves it to public/og/
// so the prerender step can reference it in the per-page meta tags.
//
// Run with the dev server up:
//   npm run dev    # in another shell
//   npx tsx scripts/og/screenshot_prices.ts
//
// Output: public/og/prices.png

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const OG_DIR = path.join(REPO_ROOT, "public/og");

const BASE = process.env.OG_BASE_URL ?? "http://localhost:5173";

const run = async (): Promise<void> => {
  fs.mkdirSync(OG_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 2, // existing og images are 2400x1260 — 2x retina
    });
    const page = await context.newPage();
    const url = `${BASE}/prices`;
    console.log(`→ ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    // Wait for the basket-index headline (its sparkline polyline) to hydrate.
    await page
      .waitForSelector("svg polyline", { timeout: 20_000 })
      .catch(() =>
        console.log("  ⚠ sparkline didn't resolve — capturing anyway"),
      );
    await page.waitForTimeout(1500);
    // Pull the price-basket section to the top so the headline + categories are
    // the hero (skips the site header chrome).
    await page.evaluate(() => {
      document
        .getElementById("prices")
        ?.scrollIntoView({ block: "start", behavior: "instant" });
    });
    await page.waitForTimeout(500);
    const outPath = path.join(OG_DIR, "prices.png");
    await page.screenshot({
      path: outPath,
      clip: { x: 0, y: 0, width: 1200, height: 630 },
    });
    const stat = fs.statSync(outPath);
    console.log(`  ✓ prices.png (${Math.round(stat.size / 1024)} KB)`);
  } finally {
    await browser.close();
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
