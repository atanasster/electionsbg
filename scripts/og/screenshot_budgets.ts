// Take the og:image screenshot for /indicators/budgets — the "Бюджети по
// кабинети" hero composition (page title + hero chart + headline highlights).
// Saves to public/og/indicators-budgets.png, referenced via staticPage(.ogImage)
// in scripts/prerender/routes.ts.
//
// Manual capture (the screenshot OG images aren't part of postbuild, which only
// runs the card-renderer scripts/og/generate.ts). Run with the dev server up:
//   npm run dev    # in another shell
//   npx tsx scripts/og/screenshot_budgets.ts
//
// Output: public/og/indicators-budgets.png (1200×630 @2x).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const OG_DIR = path.join(REPO_ROOT, "public/og");

const BASE = process.env.OG_BASE_URL ?? "http://localhost:5173";
const OUT = "indicators-budgets.png";

const run = async (): Promise<void> => {
  fs.mkdirSync(OG_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    // Tall viewport so the whole title→hero→highlights composition is rendered
    // and in-frame; we then clip the OG-standard 1200×630 window over it.
    const context = await browser.newContext({
      viewport: { width: 1200, height: 1500 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const url = `${BASE}/indicators/budgets?elections=2026_04_19`;
    console.log(`→ ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

    const hero = page
      .locator(
        'svg[aria-label*="салдо по години"], svg[aria-label*="balance by year"]',
      )
      .first();
    await hero
      .waitFor({ timeout: 20_000 })
      .catch(() => console.log("  ⚠ hero svg not found — capturing anyway"));
    await page.waitForTimeout(1200); // let bars/labels settle

    // Frame from just above the page title down through the hero + highlights.
    const title = page
      .getByRole("heading", { level: 1, name: /Бюджети по кабинети/ })
      .first();
    const tb = await title.boundingBox().catch(() => null);
    const hb = await hero.boundingBox().catch(() => null);
    const top = tb ? Math.max(0, tb.y - 18) : hb ? Math.max(0, hb.y - 140) : 0;

    const outPath = path.join(OG_DIR, OUT);
    await page.screenshot({
      path: outPath,
      clip: { x: 0, y: top, width: 1200, height: 630 },
    });
    const kb = Math.round(fs.statSync(outPath).size / 1024);
    console.log(`  ✓ ${OUT} (${kb} KB), clip top=${Math.round(top)}`);
  } finally {
    await browser.close();
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
