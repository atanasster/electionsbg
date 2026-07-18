// og:image screenshots for the consumption hub sub-pages that have a strong
// visual (a chart or a map). Captures the live SPA at 1200x630 (2x retina) and
// saves committed PNGs under public/og/ that the prerender step references.
//
// Run with the dev server up (pass the port if it's not 5173):
//   npm run dev
//   OG_BASE_URL=http://localhost:5173 npx tsx scripts/og/screenshot_consumption.ts
//
// Output: public/og/consumption-eu.png, public/og/consumption-overview.png

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const OG_DIR = path.join(REPO_ROOT, "public/og");

const BASE = process.env.OG_BASE_URL ?? "http://localhost:5173";

interface Target {
  path: string;
  out: string;
  /** the DashboardSection id to pull to the top as the hero. */
  scrollTo: string;
  /** a selector that signals the hero has rendered (best-effort). */
  wait: string;
}

const TARGETS: Target[] = [
  // The EU diverging-bar chart (pure CSS/SVG, reliable + colourful).
  {
    path: "/consumption/eu",
    out: "consumption-eu.png",
    scrollTo: "macro",
    wait: "#macro .tabular-nums",
  },
  // The municipality price choropleth (the map is the hero). Wait for a LOADED
  // Leaflet tile so the map isn't captured blank.
  {
    path: "/consumption/overview",
    out: "consumption-overview.png",
    scrollTo: "map",
    wait: "#map .leaflet-tile-loaded, #map svg path",
  },
  // The BG-vs-EU fuel-price trend (4-line Recharts chart + the vs-EU stat pair).
  {
    path: "/consumption/fuel",
    out: "consumption-fuel.png",
    scrollTo: "prices",
    wait: "#prices .recharts-line, #prices .tabular-nums",
  },
];
// Note: the chains leaderboard, category and product list pages plus the deals
// page are list-shaped (no chart / map hero), so they reuse the branded hub OG
// (/og/consumption.png) via their prerender node rather than a bespoke screenshot.

const run = async (): Promise<void> => {
  fs.mkdirSync(OG_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 2, // existing og images are 2400x1260 — 2x retina
    });
    const page = await context.newPage();
    // Optional path filter (e.g. `... screenshot_consumption.ts fuel`) so a
    // single OG can be regenerated without rewriting the others' bytes.
    const only = process.argv[2];
    const targets = only
      ? TARGETS.filter((t) => t.path.includes(only))
      : TARGETS;
    for (const t of targets) {
      const url = `${BASE}${t.path}`;
      console.log(`→ ${url}`);
      try {
        // networkidle lets the SPA hydrate + the map load its Leaflet tiles
        // (a `load`-only wait captures the map blank and scrolls before the
        // section mounts). Per-target try/catch so a slow page can't abort the
        // rest of the run.
        await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
        await page
          .waitForSelector(t.wait, { timeout: 20_000 })
          .catch(() =>
            console.log("  ⚠ hero didn't resolve — capturing anyway"),
          );
        await page.waitForTimeout(2000);
        await page.evaluate((id) => {
          document
            .getElementById(id)
            ?.scrollIntoView({ block: "start", behavior: "instant" });
        }, t.scrollTo);
        await page.waitForTimeout(800);
        const outPath = path.join(OG_DIR, t.out);
        await page.screenshot({
          path: outPath,
          clip: { x: 0, y: 0, width: 1200, height: 630 },
        });
        const stat = fs.statSync(outPath);
        console.log(`  ✓ ${t.out} (${Math.round(stat.size / 1024)} KB)`);
      } catch (err) {
        console.log(`  ✗ ${t.out} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await browser.close();
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
