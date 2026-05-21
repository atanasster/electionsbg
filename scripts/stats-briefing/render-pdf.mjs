// Render the "Statistical Methods Behind the Site" briefing to PDF.
//
// Usage:  node scripts/stats-briefing/render-pdf.mjs
//
// Reads doc.html + images/ in this folder and writes electionsbg-stats.pdf
// alongside them. The page geometry (A4, margins) comes from the @page rule
// in doc.html, so preferCSSPageSize is required. To refresh the embedded
// screenshots first, run capture-shots.mjs against the local dev server.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const out = resolve(HERE, "electionsbg-stats.pdf");

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file://${resolve(HERE, "doc.html")}`, {
  waitUntil: "networkidle",
});
await page.pdf({
  path: out,
  printBackground: true,
  preferCSSPageSize: true,
});
await browser.close();
console.log(`PDF written to ${out}`);
