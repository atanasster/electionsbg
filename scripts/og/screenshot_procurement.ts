// Take og:image screenshots of the procurement-by-settlement pages. Saves
// to public/og/procurement-by-settlement.png and per-EKATTE variants for
// the three biggest spenders. The prerender step references these via
// staticPage(.ogImage) in scripts/prerender/routes.ts.
//
// Run with the dev server up:
//   npm run dev    # in another shell
//   npx tsx scripts/og/screenshot_procurement.ts
//
// Output: public/og/procurement-by-settlement.png + per-EKATTE variants.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const OG_DIR = path.join(REPO_ROOT, "public/og");

const BASE = process.env.OG_BASE_URL ?? "http://localhost:5173";

interface Spec {
  route: string;
  file: string;
  waitFor: string;
  settleMs?: number;
}

const specs: Spec[] = [
  {
    route: "/procurement/by-settlement?elections=2026_04_19",
    file: "procurement-by-settlement.png",
    waitFor: "h1, table",
    settleMs: 1500,
  },
  {
    // Sofia city — the biggest single bubble.
    route: "/procurement/settlement/68134?elections=2026_04_19",
    file: "procurement-settlement-sofia.png",
    waitFor: "h1, table",
    settleMs: 1500,
  },
  {
    // Plovdiv.
    route: "/procurement/settlement/56784?elections=2026_04_19",
    file: "procurement-settlement-plovdiv.png",
    waitFor: "h1, table",
    settleMs: 1500,
  },
  {
    // Varna.
    route: "/procurement/settlement/10135?elections=2026_04_19",
    file: "procurement-settlement-varna.png",
    waitFor: "h1, table",
    settleMs: 1500,
  },
];

const run = async (): Promise<void> => {
  fs.mkdirSync(OG_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 2,
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
