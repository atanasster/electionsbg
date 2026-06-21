// One-off: build the OG / article-card cover for the procurement article as a
// collage of four feature screenshots on a branded dark card. Runs against the
// local dev server (images are served from /articles/images/procurement-tools/).
// Output: public/og/procurement-tools.png at 2400×1260 (2× of the 1200×630 OG
// canvas), so it differs from the older article's /og/procurement.png.
//
// Usage:
//   npm run dev
//   BASE=http://localhost:5173 node scripts/capture-procurement-og.mjs

import { chromium } from "playwright";
import { resolve } from "node:path";

const BASE = process.env.BASE || "http://localhost:5173";
const OUT = resolve("public/og/procurement-tools.png");
const IMG = (n) => `${BASE}/articles/images/procurement-tools/${n}`;

const tiles = [
  { src: IMG("05-choropleth.png"), caption: "Карти по области" },
  { src: IMG("02-entity-flow.png"), caption: "Парични потоци" },
  { src: IMG("01-risk-index.png"), caption: "Индекс на риска", pos: "top" },
  { src: IMG("06-flags.png"), caption: "Сигнали за риск", pos: "top" },
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    font-family: "Inter", system-ui, -apple-system, "Segoe UI", "DejaVu Sans", sans-serif;
    background: radial-gradient(120% 120% at 0% 0%, #103a66 0%, #0b1c33 55%, #081320 100%);
    color: #fff; padding: 44px 48px; display: flex; flex-direction: column;
  }
  .head { display: flex; align-items: baseline; gap: 16px; }
  .brand { font-size: 26px; font-weight: 800; color: #e07a4f; letter-spacing: .5px; }
  .src { margin-left: auto; font-size: 16px; color: #8fa6c2; letter-spacing: .3px; }
  h1 { font-size: 48px; font-weight: 800; margin-top: 10px; letter-spacing: -.5px; }
  .sub { font-size: 21px; color: #aebfd6; margin-top: 6px; }
  .grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
    gap: 18px; margin-top: 20px; }
  .tile { display: flex; flex-direction: column; overflow: hidden; }
  .frame { flex: 1; overflow: hidden; border-radius: 12px;
    border: 1px solid rgba(255,255,255,.14); box-shadow: 0 6px 22px rgba(0,0,0,.35);
    background: #fff; }
  .frame img { width: 100%; height: 100%; object-fit: cover; object-position: center top; display: block; }
  .cap { font-size: 15px; color: #cdd9ea; margin-top: 7px; font-weight: 600; }
</style></head><body>
  <div class="head">
    <span class="brand">наясно</span>
    <span class="src">electionsbg.com</span>
  </div>
  <h1>Обществени поръчки</h1>
  <div class="sub">Граждански инструменти за проследяване на публичните пари</div>
  <div class="grid">
    ${tiles
      .map(
        (t) => `<div class="tile"><div class="frame"><img src="${t.src}" style="object-position:center ${t.pos || "top"}"/></div><div class="cap">${t.caption}</div></div>`,
      )
      .join("")}
  </div>
</body></html>`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.setContent(html, { waitUntil: "networkidle" });
// Ensure every screenshot has actually decoded before we snap.
await page.evaluate(() =>
  Promise.all(
    [...document.images].map((i) =>
      i.complete ? Promise.resolve() : i.decode().catch(() => {}),
    ),
  ),
);
await page.waitForTimeout(400);
await page.screenshot({ path: OUT });
await browser.close();
console.log(`wrote ${OUT}`);
