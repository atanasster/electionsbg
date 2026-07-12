// Take an og:image screenshot of the problem-sections dashboard
// (/reports/section/problem_sections). Saves to public/og/problem-sections.png.
// The prerender step references it via ReportEntry.ogImage in
// scripts/prerender/dynamicRoutes.ts (buildReportRoutes).
//
// Run with the dev server up (needs the report JSON + map tiles):
//   npm run dev    # in another shell
//   npx tsx scripts/og/screenshot_problem_sections.ts
//
// Output: public/og/problem-sections.png (1200×630 CSS px @2x → 2400×1260 PNG).

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
      viewport: { width: 1200, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const url = `${BASE}/reports/section/problem_sections?elections=2026_04_19`;
    console.log(`→ ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    // Wait for the section map tile (leaflet) — the last thing to render.
    await page
      .waitForSelector(".leaflet-container", { timeout: 20_000 })
      .catch(() => {
        console.log(
          "  ⚠ .leaflet-container didn't resolve — capturing anyway",
        );
      });
    await page.waitForTimeout(2500);
    // Frame the OG clip on the dashboard (KPI cards + map + top parties).
    // Keep the branded sticky header, but land the dashboard just below it so
    // the KPI card titles aren't clipped and the neighborhood-chip strip above
    // the dashboard is scrolled fully out of frame.
    await page.evaluate(() => {
      const el = document.querySelector("section[aria-label]");
      if (!el) return;
      // Height of whatever is stuck to the top of the viewport (nav header).
      const header = document.querySelector("header");
      const headerH = header ? header.getBoundingClientRect().height : 96;
      const y = el.getBoundingClientRect().top + window.scrollY - headerH + 8;
      window.scrollTo(0, y);
    });
    await page.waitForTimeout(600);
    const outPath = path.join(OG_DIR, "problem-sections.png");
    await page.screenshot({
      path: outPath,
      clip: { x: 0, y: 0, width: 1200, height: 630 },
    });
    const stat = fs.statSync(outPath);
    console.log(
      `  ✓ problem-sections.png (${Math.round(stat.size / 1024)} KB)`,
    );
  } finally {
    await browser.close();
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
