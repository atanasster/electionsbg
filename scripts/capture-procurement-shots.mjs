// One-off: capture the procurement-feature screenshots for the
// "Following the public money" article. Runs against the local Vite dev server.
// Each shot either clips a dashboard Card (by a heading it contains) or grabs
// the viewport. Bulgarian UI, 2× DPI — matching the other article images.
// Doubles as a UI smoke test: a missing heading logs a skip.
//
// Usage:
//   npm run dev                              # in one terminal (port 5173)
//   node scripts/capture-procurement-shots.mjs
//   BASE=http://localhost:57243 node scripts/capture-procurement-shots.mjs

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE || "http://localhost:5173";
const OUT_DIR = resolve("public/articles/images/procurement-tools");
mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };

// url → list of shots. `heading` clips the enclosing Card; `viewport` grabs the
// fold; `scrollTo` scrolls a heading into view first (for viewport shots).
const PAGES = [
  {
    // Same contract the article links to ("see it live"): the €33M MTSP
    // financing deal — single bidder + limited procedure, a clean risk example.
    url: "/procurement/contract/701291266900",
    shots: [{ name: "01-risk-index", viewport: true }],
  },
  {
    url: "/company/103267194",
    shots: [
      { name: "02-entity-flow", heading: "Откъде идват парите", padding: 10 },
      { name: "03-treemap", heading: "Приходи по възложители", padding: 10 },
    ],
  },
  {
    // Officials demo: a company whose connected person is a DECLARED stake
    // (councillor with a 10% holding), the strongest evidence type — not a
    // bare name match. Софарма Трейдинг (103267194) used to host this shot,
    // but its only "connection" was a common-name TR collision that the
    // namesake fix correctly dropped.
    url: "/company/202758921",
    shots: [{ name: "04-officials", heading: "Свързани служители", padding: 10 }],
  },
  {
    url: "/procurement/by-settlement",
    shots: [
      { name: "05-choropleth", heading: "Местни поръчки по области", padding: 10 },
    ],
  },
  {
    // Viewport (not a card clip): the fold shows the summary tiles
    // (concentration / MP-tied / connected people / debarments) + the oblast
    // heat-map — the dashboard the article text describes. A heading clip would
    // grab only the 100%-pair list further down ("Концентрация…" also titles
    // that section), which is less representative.
    url: "/procurement/flags?pscope=all",
    shots: [{ name: "06-flags", viewport: true }],
  },
  {
    url: "/procurement/people",
    shots: [{ name: "07-scanner", viewport: true }],
  },
  {
    url: "/governance/PDV22",
    shots: [
      { name: "08-myarea", heading: "Обществени поръчки тук", padding: 10 },
    ],
  },
];

async function clipCard(page, shot) {
  const sel = (headingText) => {
    const h = [...document.querySelectorAll("h1,h2,h3,h4")].find((e) =>
      (e.textContent || "").trim().startsWith(headingText),
    );
    if (!h) return null;
    const card = h.closest(".rounded-xl") || h.parentElement;
    card.scrollIntoView({ block: "center" });
    const r = card.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };
  let box = await page.evaluate(sel, shot.heading);
  if (!box) {
    console.warn(`  SKIP ${shot.name} — heading "${shot.heading}" not found`);
    return false;
  }
  await page.waitForTimeout(600);
  box = await page.evaluate(sel, shot.heading);
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
  locale: "bg-BG",
});
const page = await ctx.newPage();

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.setItem("language", "bg");
  localStorage.setItem("i18nextLng", "bg");
});

for (const p of PAGES) {
  await page.goto(`${BASE}${p.url}`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  for (const shot of p.shots) {
    if (shot.viewport) {
      await page.screenshot({ path: `${OUT_DIR}/${shot.name}.png` });
      console.log(`  wrote ${shot.name}.png (viewport)`);
    } else {
      await clipCard(page, shot);
    }
  }
}

await browser.close();
console.log(`done. images in ${OUT_DIR}`);
