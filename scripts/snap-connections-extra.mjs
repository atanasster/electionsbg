// Re-capture failed shots and add path-finding example.
import { chromium } from "playwright";
import path from "node:path";

const OUT = "/Users/atanasster/data-bg/docs/images/connections";
const BASE = "http://localhost:5173";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("i18nextLng", "en");
    localStorage.setItem("language", "en");
    localStorage.setItem("theme", "light");
  } catch {}
});
const page = await ctx.newPage();

// ---- 02 Sofia regional dashboard ----
{
  await page.goto(BASE + "/sofia", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  const handle = await page
    .locator("div", { hasText: "MP BUSINESS CONNECTIONS" })
    .last()
    .elementHandle()
    .catch(() => null);
  if (handle) {
    const card = await handle.evaluateHandle((el) =>
      el.closest('[class*="rounded"]')?.parentElement || el,
    );
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await card.screenshot({ path: path.join(OUT, "02-sofia-region-tile.png") });
    console.log("saved 02-sofia-region-tile.png");
  } else {
    console.log("02 not found");
  }
}

// ---- 04 Management roles (re-capture properly) ----
{
  await page.goto(BASE + "/candidate/" + encodeURIComponent("ДИМИТЪР ГЕОРГИЕВ НАЙДЕНОВ"), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
  // Use the lucide icon class as a fingerprint, or the i18n key text "Management roles"
  // From the source: title key is "tr_management_roles" which maps to "Management roles" in EN
  const handle = await page
    .locator("text=/^Management roles/i")
    .first()
    .elementHandle()
    .catch(() => null);
  if (handle) {
    const card = await handle.evaluateHandle((el) => {
      let cur = el;
      while (cur && cur.parentElement) {
        const cls = (cur.className || "").toString();
        if (cls.includes("rounded-xl")) return cur;
        cur = cur.parentElement;
      }
      return el.parentElement?.parentElement || el;
    });
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await card.screenshot({ path: path.join(OUT, "04-candidate-management.png") });
    console.log("saved 04-candidate-management.png");
  } else {
    // dump available headings
    const headings = await page.locator("h2,h3,h4,div[class*='font-semibold']")
      .allTextContents();
    console.log("04 not found. Headings:", headings.slice(0, 30));
  }
}

// ---- 11 Path-finding demo: G.Georgiev (GERB) -> R.Uzunov (PB) ----
{
  await page.goto(BASE + "/connections", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);
  // Click "Find connection between two MPs" button
  const findBtn = await page
    .locator(":text-matches('Find connection between two MPs|Намери връзка между двама', 'i')")
    .first()
    .elementHandle()
    .catch(() => null);
  if (findBtn) {
    await findBtn.click().catch(() => {});
    await page.waitForTimeout(800);
    // Click first MP node — try via search input
    const input = await page.locator("input[placeholder*='earch'], input[placeholder*='арси']").first().elementHandle().catch(() => null);
    if (input) {
      await input.fill("ГЕОРГИ ИВАНОВ ГЕОРГИЕВ");
      await page.waitForTimeout(500);
      // Click the first matching suggestion
      const sug = await page.locator(":text-matches('ГЕОРГИ ИВАНОВ ГЕОРГИЕВ', 'i')").first().elementHandle().catch(() => null);
      if (sug) await sug.click().catch(() => {});
      await page.waitForTimeout(800);
      await input.fill("РАШИД МЕХМЕДОВ УЗУНОВ");
      await page.waitForTimeout(500);
      const sug2 = await page.locator(":text-matches('РАШИД МЕХМЕДОВ УЗУНОВ', 'i')").first().elementHandle().catch(() => null);
      if (sug2) await sug2.click().catch(() => {});
      await page.waitForTimeout(2500);
    }
  }
  await page.screenshot({ path: path.join(OUT, "11-orbital-pathfind-attempt.png"), fullPage: true });
  console.log("saved 11-orbital-pathfind-attempt.png");
}

await browser.close();
console.log("done.");
