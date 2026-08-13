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
  // funds-calls MOVED to scripts/og/capture-screens.ts (slug `funds-calls`).
  // This script clips {x:0,y:0} unconditionally and hides no site chrome, so the
  // card it produced here was half nav bar and community banner with the table
  // starting below the fold — measured, not assumed. capture-screens.ts drops
  // the header and anchors the clip on the h1. Do not re-add a spec here: two
  // producers writing one file is the shape that drifts.
  {
    route: "/funds/focus/guest-houses?elections=2026_04_19",
    file: "funds-focus.png",
    waitFor: "h1",
    settleMs: 1500,
  },
];

// Optional CLI filter, by output file stem:
//   npx tsx scripts/og/screenshot_funds.ts funds-calls
// Shoot ONE card rather than the whole set. Without this the script re-frames
// every /funds card on every run, so fixing one that was never captured also
// re-shoots five that were fine — and a page that has moved since comes back
// worse, silently, because nothing downstream looks at the pixels. Unknown
// stems fail loudly rather than shooting nothing (matches screenshot_sectors).
const only = process.argv
  .slice(2)
  .flatMap((a) => a.split(","))
  .map((s) => s.trim().replace(/\.png$/, ""))
  .filter(Boolean);
const known = specs.map((s) => s.file.replace(/\.png$/, ""));
const unknown = only.filter((s) => !known.includes(s));
if (unknown.length)
  throw new Error(
    `unknown card(s): ${unknown.join(", ")} — known: ${known.join(", ")}`,
  );
const selected = only.length
  ? specs.filter((s) => only.includes(s.file.replace(/\.png$/, "")))
  : specs;

const run = async (): Promise<void> => {
  fs.mkdirSync(OG_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 2, // existing og images are 2400x1260 — 2x retina
    });
    const page = await context.newPage();
    for (const spec of selected) {
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
