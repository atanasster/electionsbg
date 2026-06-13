// One-off: capture the screenshots for the tax-policy-simulator methodology
// article (public/articles/2026-06-12-tax-policy-simulator-{bg,en}.md). Same
// clip-by-selector pattern as scripts/capture-budget-shots.mjs, but loops both
// UI languages and targets the simulator's `data-shot` cards under a rich
// scenario, so each article references its own-language image set.
//
// Usage:
//   npm run dev                                   # in one terminal (or set BASE)
//   node scripts/capture-simulator-shots.mjs       # BASE defaults to :5173

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE || "http://localhost:5173";
// A rich, EDP-meeting scenario so every card shows non-trivial content:
// VAT 22%, progressive-ish PIT 15%, admin −10%, goal = Maastricht (default).
const SCENARIO = "dds=22&pit=15&adm=10";
const VIEWPORT = { width: 1380, height: 1000 };

const SHOTS = [
  { name: "01-scoreboard", selector: '[data-shot="scoreboard"]' },
  { name: "02-headline", selector: '[data-shot="headline"]' },
  { name: "03-breakdown", selector: '[data-shot="breakdown"]' },
  { name: "04-deciles", selector: '[data-shot="deciles"]' },
  { name: "05-citizen", selector: '[data-shot="citizen"]' },
  { name: "06-projection", selector: '[data-shot="projection"]' },
];

async function captureClipped(page, shot, outDir) {
  const el = page.locator(shot.selector).first();
  if ((await el.count()) === 0) {
    console.warn(`  skip ${shot.name} — selector matched nothing`);
    return false;
  }
  await el.scrollIntoViewIfNeeded();
  // Push the element ~90px down so the sticky top nav doesn't bleed into the
  // clip (tall cards otherwise align flush under the header).
  await page.evaluate(() => window.scrollBy(0, -90));
  // Recharts / SVG gauges lay out late — give them a paint frame.
  await page.waitForTimeout(500);
  const box = await el.boundingBox();
  if (!box) {
    console.warn(`  skip ${shot.name} — no bounding box`);
    return false;
  }
  const pad = 10;
  await page.screenshot({
    path: `${outDir}/${shot.name}.png`,
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
for (const lang of ["bg", "en"]) {
  const outDir = resolve(`public/articles/images/budget_simulator/${lang}`);
  mkdirSync(outDir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    locale: lang === "bg" ? "bg-BG" : "en-GB",
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate((l) => {
    localStorage.setItem("language", l);
    localStorage.setItem("i18nextLng", l);
  }, lang);
  await page.goto(`${BASE}/budget/simulator?${SCENARIO}`, {
    waitUntil: "networkidle",
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  console.log(`\n[${lang}] -> ${outDir}`);
  for (const shot of SHOTS) await captureClipped(page, shot, outDir);
  await ctx.close();
}
await browser.close();
console.log("\ndone.");
