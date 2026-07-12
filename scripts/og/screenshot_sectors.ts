// Take og:image screenshots of the generic sector dashboards (/sector/:id).
// Saves to public/og/sector-<id>.png. The prerender step references these via
// staticPage(.ogImage) in scripts/prerender/routes.ts (SECTOR_PAGES).
//
// Run with the dev server up (needs the /api/db endpoints for the KPI + charts):
//   npm run dev    # in another shell
//   npx tsx scripts/og/screenshot_sectors.ts
//
// Output: public/og/sector-<id>.png (1200×630 CSS px @2x → 2400×1260 PNG).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "@playwright/test";
import { SECTOR_DASHBOARD_IDS } from "@/screens/sector/sectorDashboards";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const OG_DIR = path.join(REPO_ROOT, "public/og");

const BASE = process.env.OG_BASE_URL ?? "http://localhost:5173";

// Single source of truth — every sector dashboard gets a screenshot.
const SECTOR_IDS = SECTOR_DASHBOARD_IDS;

const run = async (): Promise<void> => {
  fs.mkdirSync(OG_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    for (const id of SECTOR_IDS) {
      const url = `${BASE}/sector/${id}?elections=2026_04_19`;
      console.log(`→ ${url}`);
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      // Wait for the awarders tile (always rendered) + a chart bar (when data).
      await page
        .waitForSelector("#sector-awarders", { timeout: 20_000 })
        .catch(() => {
          console.log(
            "  ⚠ #sector-awarders didn't resolve — capturing anyway",
          );
        });
      await page.waitForTimeout(1800);
      // Scroll the dashboard (h1 + KPIs + charts) to the top so the OG clip
      // frames the content, not the site header / promo banner.
      await page.evaluate(() => {
        const el = document.querySelector("#sector-dashboard");
        if (el) {
          const y = el.getBoundingClientRect().top + window.scrollY - 16;
          window.scrollTo(0, y);
        }
      });
      await page.waitForTimeout(400);
      const outPath = path.join(OG_DIR, `sector-${id}.png`);
      await page.screenshot({
        path: outPath,
        clip: { x: 0, y: 0, width: 1200, height: 630 },
      });
      const stat = fs.statSync(outPath);
      console.log(`  ✓ sector-${id}.png (${Math.round(stat.size / 1024)} KB)`);
    }
  } finally {
    await browser.close();
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
