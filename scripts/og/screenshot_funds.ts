// Take og:image screenshots of the EU-funds pages. The screenshots capture
// the live SPA at 1200x630 (the canonical og:image aspect ratio) and save
// them to public/og/ so the prerender step can reference them in the
// per-page meta tags.
//
// Run with the dev server up:
//   npm run dev    # in another shell
//   npx tsx scripts/og/screenshot_funds.ts
//
// Output: public/og/funds.png + per-subpage variants.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const OG_DIR = path.join(REPO_ROOT, "public/og");

const BASE = process.env.OG_BASE_URL ?? "http://localhost:5173";

// Each spec: route to navigate to, file name, optional pre-screenshot
// scroll target (CSS selector to scroll into view before capturing).
interface Spec {
  route: string;
  file: string;
  // CSS selector to wait for before capturing — guarantees the live data
  // has hydrated.
  waitFor: string;
  // Extra wait after `waitFor` resolves (ms). Charts often render an
  // intermediate empty state; this gives them time to settle.
  settleMs?: number;
  // Optional selector to scrollIntoView before screenshot — keeps the
  // visual hero (map / chart) above the fold.
  scrollTo?: string;
}

const specs: Spec[] = [
  {
    route: "/funds?elections=2026_04_19",
    file: "funds.png",
    // Wait for the choropleth tile + KPI strip.
    waitFor: 'h1, [class*="text-base"]:has(svg)',
    settleMs: 1500,
  },
  {
    route: "/funds/political?elections=2026_04_19",
    file: "funds-political.png",
    waitFor: "h1",
    settleMs: 1500,
  },
  {
    route: "/funds/integrity?elections=2026_04_19",
    file: "funds-integrity.png",
    waitFor: "h1",
    settleMs: 1500,
  },
  {
    route: "/funds/rrf?elections=2026_04_19",
    file: "funds-rrf.png",
    waitFor: "h1",
    settleMs: 1500,
  },
  {
    route: "/funds/focus/guest-houses?elections=2026_04_19",
    file: "funds-focus.png",
    waitFor: "h1",
    settleMs: 1500,
  },
];

const run = async (): Promise<void> => {
  fs.mkdirSync(OG_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 2, // existing og images are 2400x1260 — 2x retina
    });
    const page = await context.newPage();
    for (const spec of specs) {
      const url = `${BASE}${spec.route}`;
      console.log(`→ ${url}`);
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      await page
        .waitForSelector(spec.waitFor, { timeout: 20_000 })
        .catch(() => {
          console.log(
            `  ⚠ waitFor "${spec.waitFor}" didn't resolve — capturing anyway`,
          );
        });
      if (spec.settleMs) await page.waitForTimeout(spec.settleMs);
      if (spec.scrollTo) {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          el?.scrollIntoView({ block: "start", behavior: "instant" });
        }, spec.scrollTo);
        await page.waitForTimeout(500);
      }
      const outPath = path.join(OG_DIR, spec.file);
      await page.screenshot({
        path: outPath,
        clip: { x: 0, y: 0, width: 1200, height: 630 },
      });
      const stat = fs.statSync(outPath);
      console.log(`  ✓ ${spec.file} (${Math.round(stat.size / 1024)} KB)`);
    }
  } finally {
    await browser.close();
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
