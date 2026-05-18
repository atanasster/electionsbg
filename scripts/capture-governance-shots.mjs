// One-off: capture the screenshots referenced by the governance article.
// Runs against the local Vite dev server (http://localhost:5173). Each shot
// scrolls a specific dashboard tile into view and clips to its bounding box,
// so the resulting PNGs frame just the relevant chunk of UI.
//
// Usage:
//   npm run dev           # in one terminal
//   node scripts/capture-governance-shots.mjs

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:5173";
const ELECTION = "2026_04_19";
const OUT_DIR = resolve("public/articles/images/governance");
mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };

// Each shot picks a DOM target by CSS selector, scrolls it into view,
// waits for layout to settle, then captures either the target's bbox or
// the full visible viewport. `padding` adds breathing room around the
// element clip.
const SHOTS = [
  {
    name: "01-headline-strip",
    selector: '[aria-label="Governance indicators"], [aria-label="Управленски показатели"]',
    padding: 12,
  },
  {
    name: "02-cabinet-timeline",
    selector: '[class*="overflow-hidden"]:has(div[aria-label*="Cabinet stability"]), [class*="overflow-hidden"]:has(div[aria-label*="Стабилност"])',
    padding: 8,
    fallback: "section#governments, [id='governments']",
  },
  {
    name: "03-parliament-tiles",
    selector: "section#parliament, [id='parliament']",
    padding: 8,
  },
  {
    name: "04-budget-section",
    selector: "section#budget, [id='budget']",
    padding: 8,
  },
  {
    name: "05-macro-wgi-cards",
    // The five WGI/macro indicator cards sit in a single 3-col grid inside
    // the macro section; clip to just that grid so the screenshot isn't
    // dominated by the surrounding tiles.
    selector: "section#macro div.grid.gap-3.grid-cols-1.sm\\:grid-cols-2.lg\\:grid-cols-3:not(:has(svg.lucide-scroll-text))",
    padding: 8,
    fallback: "section#macro",
  },
  {
    name: "06-osce-debt-row",
    selector: "section#macro div.grid:has([class*=ScrollText]), section#macro div.grid:has(svg.lucide-coins)",
    padding: 8,
    fallback: "section#macro",
  },
  {
    name: "07-peer-comparison",
    selector: '[data-og="budget-peer-comparison"]',
    padding: 8,
  },
  {
    name: "08-declarations",
    selector: "section#declarations, [id='declarations']",
    padding: 8,
  },
  {
    name: "09-procurement",
    selector: "section#procurement, [id='procurement']",
    padding: 8,
  },
  {
    name: "10-financing",
    selector: "section#financing, [id='financing']",
    padding: 8,
  },
  {
    name: "11-articles",
    selector: "section#articles, [id='articles']",
    padding: 8,
  },
];

async function captureClipped(page, shot) {
  const target = page.locator(shot.selector).first();
  let count = await target.count();
  let el = target;
  if (count === 0 && shot.fallback) {
    el = page.locator(shot.fallback).first();
    count = await el.count();
  }
  if (count === 0) {
    console.warn(`  skip ${shot.name} — selector matched nothing`);
    return false;
  }
  await el.scrollIntoViewIfNeeded();
  // Recharts containers can lay out late — give them a paint frame.
  await page.waitForTimeout(400);
  const box = await el.boundingBox();
  if (!box) {
    console.warn(`  skip ${shot.name} — no bounding box`);
    return false;
  }
  const pad = shot.padding ?? 8;
  await page.screenshot({
    path: `${OUT_DIR}/${shot.name}.png`,
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.width + pad * 2,
      height: box.height + pad * 2,
    },
  });
  console.log(`  wrote ${shot.name}.png (${Math.round(box.width)}×${Math.round(box.height)})`);
  return true;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  locale: "en-GB",
});
const page = await ctx.newPage();

// Seed language so the rendered text is in English for the article. The
// app reads i18nextLng from localStorage on boot, so we set it before
// the first navigation that loads /governance. i18next caches the
// language on init, so a second navigation is required to pick it up.
await page.goto(`${BASE}/`);
await page.evaluate(() => {
  // src/i18n.ts reads `language` (not i18next's default `i18nextLng`); both
  // are set to keep any other init path happy too.
  localStorage.setItem("language", "en");
  localStorage.setItem("i18nextLng", "en");
});
await page.goto(`${BASE}/governance?elections=${ELECTION}`, {
  waitUntil: "networkidle",
});
// Force a full reload after the language is seeded so i18next initialises
// against the new value (the first nav already initialised it as 'bg').
await page.reload({ waitUntil: "networkidle" });
// Recharts + lazy-loaded data: wait a beat for late renders.
await page.waitForTimeout(1500);

for (const shot of SHOTS) {
  await captureClipped(page, shot);
}

await browser.close();
console.log(`done. images in ${OUT_DIR}`);
