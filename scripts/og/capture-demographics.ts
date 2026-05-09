// One-off Playwright capture for the /demographics OG image. Run while the
// Vite dev server is up at http://localhost:5173:
//
//   npx tsx scripts/og/capture-demographics.ts
//
// The image is shaped to OG's 1200x630 ratio and clipped to the choropleth
// map (with its colour legend) so the social card reads as a Bulgaria-shaped
// thumbnail rather than an unidentifiable header strip.
import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const OUT = path.resolve("public/og/demographics.png");
const URL = "http://localhost:5173/demographics";

const main = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1100 },
    deviceScaleFactor: 2,
    locale: "bg-BG",
  });
  await context.addInitScript(() => {
    localStorage.setItem("language", "bg");
  });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60_000 });
  await page.addStyleTag({
    content: `
      nav.fixed{display:none!important;}
      header,header *{display:none!important;}
      body{padding-top:0!important;}
    `,
  });
  // Scroll the map heading to the top so the choropleth fills the visible
  // viewport, then wait for tile loading + SVG render to settle.
  await page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll("h2")).find((h) =>
      h.textContent?.includes("Карта"),
    );
    heading?.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(2500);

  const map = await page.locator(".leaflet-container").first().boundingBox();
  if (!map) throw new Error("Could not find leaflet map");
  // OG cards render at 1200x630. Centre the clip on the map and grow it to
  // that aspect ratio, padding above/below if needed.
  const targetWidth = Math.min(1200, Math.round(map.width));
  const targetHeight = Math.round((targetWidth * 630) / 1200);
  const clipX = Math.round(map.x + (map.width - targetWidth) / 2);
  const clipY = Math.round(map.y + (map.height - targetHeight) / 2);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await page.screenshot({
    path: OUT,
    clip: {
      x: Math.max(0, clipX),
      y: Math.max(0, clipY),
      width: targetWidth,
      height: targetHeight,
    },
  });
  console.log(`wrote ${OUT} (${targetWidth}x${targetHeight})`);
  await browser.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
