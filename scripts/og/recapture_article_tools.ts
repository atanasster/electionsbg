// One-off: re-capture the two stale procurement-article tool screenshots
//   - 01-risk-index.png  (example contract page, risk-index meter + chips)
//   - 06-flags.png       (red-flag feed — redesigned with summary tiles + oblast heatmap)
// Run with the dev server up on :5173 (npm run dev), then:
//   npx tsx scripts/og/recapture_article_tools.ts
// Output overwrites public/articles/images/procurement-tools/{01,06}*.png.

import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(
  REPO_ROOT,
  "public/articles/images/procurement-tools",
);
const BASE = process.env.OG_BASE_URL ?? "http://localhost:5173";

const run = async (): Promise<void> => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1404, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    // 01 — example contract with the explainable risk index.
    await page.goto(`${BASE}/procurement/contract/701291266900`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await page
      .waitForSelector("text=ИНДЕКС НА РИСКА", { timeout: 20_000 })
      .catch(() => console.log("  ⚠ risk text not found — capturing anyway"));
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: path.join(OUT_DIR, "01-risk-index.png"),
      clip: { x: 0, y: 0, width: 1404, height: 900 },
    });
    console.log("  ✓ 01-risk-index.png");

    // 06 — red-flag feed (redesigned: summary tiles + per-oblast heatmap).
    await page.goto(`${BASE}/procurement/flags`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await page
      .waitForSelector("text=Концентрация върху един изпълнител", {
        timeout: 20_000,
      })
      .catch(() => console.log("  ⚠ flags text not found — capturing anyway"));
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: path.join(OUT_DIR, "06-flags.png"),
      clip: { x: 0, y: 0, width: 1404, height: 900 },
    });
    console.log("  ✓ 06-flags.png");
  } finally {
    await browser.close();
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
