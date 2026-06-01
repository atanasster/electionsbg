// One-off: capture the My-Area dashboard screenshots referenced by the
// "Local councils and capital programmes" article. Runs against the local
// Vite dev server (http://localhost:5173). Each shot tags a dashboard tile
// (by its heading text) and clips to its bounding box at 2× DPI, matching
// the other article og images.
//
// Usage:
//   npm run dev           # in one terminal
//   node scripts/capture-myarea-shots.mjs

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:5173";
// Veliko Tarnovo município (area code VTR04 → council key VTR01) — the
// article's hero example: a Tier-A council (per-councillor named votes) that
// also has an ingested capital programme.
const AREA = "VTR04";
// Expand the freshest named-vote resolution so the council tile renders its
// per-councillor avatar strip (the platform's signature visual).
const EXPAND = "VTR01-2026-prot40-r997";
const OUT_DIR = resolve("public/articles/images/local_government");
mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };

// Each shot picks a tile by the text of a heading it contains, walks up to
// the closest rounded-xl Card ancestor, and clips that. `padding` adds
// breathing room around the clip.
const SHOTS = [
  { name: "01-council-tile", heading: "Municipal council", padding: 10 },
  {
    name: "02-capital-programme",
    heading: "Veliko Tarnovo investment programme",
    padding: 10,
  },
];

async function captureByHeading(page, shot) {
  // Tag the target card in-page, returning its viewport-relative bbox.
  const box = await page.evaluate((headingText) => {
    const h = [...document.querySelectorAll("h1,h2,h3,h4")].find((e) =>
      (e.textContent || "").trim().startsWith(headingText),
    );
    if (!h) return null;
    let card = h.closest(".rounded-xl") || h.parentElement;
    card.scrollIntoView({ block: "center" });
    const r = card.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, shot.heading);

  if (!box) {
    console.warn(`  skip ${shot.name} — heading "${shot.heading}" not found`);
    return false;
  }
  // Let any late layout (charts, avatar grid) settle after the scroll.
  await page.waitForTimeout(500);
  const box2 = await page.evaluate((headingText) => {
    const h = [...document.querySelectorAll("h1,h2,h3,h4")].find((e) =>
      (e.textContent || "").trim().startsWith(headingText),
    );
    const card = h.closest(".rounded-xl") || h.parentElement;
    const r = card.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, shot.heading);

  const pad = shot.padding ?? 8;
  await page.screenshot({
    path: `${OUT_DIR}/${shot.name}.png`,
    clip: {
      x: Math.max(0, box2.x - pad),
      y: Math.max(0, box2.y - pad),
      width: box2.width + pad * 2,
      height: box2.height + pad * 2,
    },
  });
  console.log(
    `  wrote ${shot.name}.png (${Math.round(box2.width)}×${Math.round(box2.height)})`,
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

await page.goto(`${BASE}/`);
await page.evaluate(() => {
  localStorage.setItem("language", "en");
  localStorage.setItem("i18nextLng", "en");
});
await page.goto(`${BASE}/my-area/${AREA}?expandedCouncil=${EXPAND}`, {
  waitUntil: "networkidle",
});
// Full reload so i18next initialises against the seeded language.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1800);

for (const shot of SHOTS) {
  await captureByHeading(page, shot);
}

await browser.close();
console.log(`done. images in ${OUT_DIR}`);
