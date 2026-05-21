// Re-capture the screenshots embedded in the briefing (doc.html) from the
// live local dev server.
//
// Usage:
//   npm run dev                                   # in one terminal
//   node scripts/stats-briefing/capture-shots.mjs
//
// Covers four of the eight figures — the two homepage tiles and the two
// risk pages that move with each data refresh. The other four
// (polls.png, ml-page.png, benford.png, risk-index.png) were captured by
// hand and are committed as static inputs; re-capture them manually if a
// site redesign makes them stale.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "images");
const BASE = "http://localhost:5173";
const ELECTION = "2026_04_19";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1100 },
  deviceScaleFactor: 2,
  locale: "en-GB",
});
const page = await ctx.newPage();

// Seed English + the corporate theme so the captured UI matches the rest
// of the briefing's screenshots.
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.setItem("language", "en");
  localStorage.setItem("i18nextLng", "en");
  localStorage.setItem("theme", "corporate");
});

// --- homepage tiles: demographics.png, voteflow.png ---
await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(5000);

async function shotCard(title, outfile) {
  const titleEl = page.getByText(title, { exact: true }).first();
  await titleEl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(3500); // let the chart / sankey render
  const card = titleEl.locator(
    'xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," bg-card ")][1]',
  );
  await card.screenshot({ path: `${OUT}/${outfile}` });
  console.log(`wrote ${outfile}`);
}
await shotCard("Demographic cleavages", "demographics.png");
await shotCard("Vote flow", "voteflow.png");

// --- risk-score.png: top of the section-risk screening table ---
await page.goto(`${BASE}/risk-score?elections=${ELECTION}`, {
  waitUntil: "networkidle",
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(500);
await page.screenshot({
  path: `${OUT}/risk-score.png`,
  clip: { x: 0, y: 0, width: 1600, height: 1040 },
});
console.log("wrote risk-score.png");

// --- clusters.png: the "Recurring risk clusters" card on /risk-analysis ---
await page.goto(`${BASE}/risk-analysis?elections=${ELECTION}`, {
  waitUntil: "networkidle",
});
await page.waitForTimeout(3000);
const titleEl = page
  .getByText("Recurring risk clusters", { exact: true })
  .first();
await titleEl.scrollIntoViewIfNeeded();
await page.waitForTimeout(1500);
const card = titleEl.locator(
  'xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," bg-card ")][1]',
);
await card.screenshot({ path: `${OUT}/clusters.png` });
console.log("wrote clusters.png");

await browser.close();
console.log("DONE");
