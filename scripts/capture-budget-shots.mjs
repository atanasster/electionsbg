// One-off: capture the screenshots referenced by the budget scorecard
// article. Same pattern as scripts/capture-governance-shots.mjs but for the
// /budget dashboard tiles.
//
// Usage:
//   npm run dev           # in one terminal
//   node scripts/capture-budget-shots.mjs

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:5173";
const ELECTION = "2026_04_19";
const OUT_DIR = resolve("public/articles/images/budget");
mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };

const SHOTS = [
  {
    name: "01-headline-strip",
    selector: '[data-og="budget-stats"]',
    padding: 12,
  },
  {
    name: "02-execution-trend",
    selector: '[data-og="budget-trend"]',
    padding: 8,
  },
  {
    name: "03-flow-sankey",
    selector: '[data-og="budget-flow"]',
    padding: 8,
  },
  {
    name: "04-tax-bill",
    selector: '[data-og="budget-tax-bill"]',
    padding: 8,
  },
  {
    name: "05-functional-cofog",
    selector: '[data-og="budget-functional"]',
    padding: 8,
  },
  {
    name: "06-top-deviations",
    selector: '[data-og="budget-top-deviations"]',
    padding: 8,
  },
  {
    name: "07-ministries",
    selector: '[data-og="budget-ministries"]',
    padding: 8,
  },
  {
    name: "08-journey",
    selector: '[data-og="budget-journey"]',
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
  // Recharts / Sankey containers can lay out late — give them a paint frame.
  await page.waitForTimeout(500);
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
  console.log(
    `  wrote ${shot.name}.png (${Math.round(box.width)}×${Math.round(box.height)})`,
  );
  return true;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  locale: "en-GB",
});
const page = await ctx.newPage();

// Seed language to English to match the governance-shots convention. The
// BG article reuses the EN screenshots — labels in the budget tiles are
// short enough that this is acceptable.
await page.goto(`${BASE}/`);
await page.evaluate(() => {
  localStorage.setItem("language", "en");
  localStorage.setItem("i18nextLng", "en");
});
await page.goto(`${BASE}/budget?elections=${ELECTION}`, {
  waitUntil: "networkidle",
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);

for (const shot of SHOTS) {
  await captureClipped(page, shot);
}

await browser.close();
console.log(`done. images in ${OUT_DIR}`);
