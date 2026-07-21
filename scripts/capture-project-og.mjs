// Capture the project-dossier OG / showcase screenshots straight from the running
// dev server: the hub tile grid and a data-filled dossier. Output at 2400×1260
// (2× the 1200×630 OG canvas), matching the other public/og/*.png cards.
//
// Usage (dev server must be up and proxying /api/db):
//   BASE=http://localhost:57857 node scripts/capture-project-og.mjs

import { chromium } from "playwright";
import { resolve } from "node:path";

const BASE = process.env.BASE || "http://localhost:5173";

// Dismiss the community/news promo card + the sticky app header so the OG frame
// shows only the feature. Best-effort — missing nodes are ignored.
const declutter = () => {
  for (const el of document.querySelectorAll("header, [data-og-hide]"))
    el.style.display = "none";
  const close = [...document.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label")?.match(/затвори|close/i) ||
      b.textContent?.trim() === "×",
  );
  close?.click();
  // Hide the top promo/news banner (the orange community card + the two news
  // teasers) — it's the first big block before the <h1>.
  const h1 = document.querySelector("h1");
  if (h1) {
    let n = h1.parentElement?.firstElementChild;
    while (n && n !== h1 && !n.contains(h1)) {
      if (/Влез в общността|Наясно|ЮЛИ|ЮНИ/.test(n.textContent || ""))
        n.style.display = "none";
      n = n.nextElementSibling;
    }
  }
  window.scrollTo(0, 0);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

const shots = [
  {
    url: `${BASE}/procurement/project`,
    ready: "text=Проектни досиета",
    out: "public/og/procurement-project.png",
  },
  {
    url: `${BASE}/procurement/project/hemus`,
    ready: "text=Договорено",
    out: "public/og/procurement-project-hemus.png",
  },
];

for (const s of shots) {
  await page.goto(s.url, { waitUntil: "networkidle" });
  await page.waitForSelector(s.ready, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(declutter);
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(s.out) });
  console.log("wrote", s.out);
}

await browser.close();
