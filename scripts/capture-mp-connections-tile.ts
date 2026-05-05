// One-shot helper: launch a headless browser against the running Vite dev
// server, scroll to the "Connections to other MPs" tile on a candidate page,
// and save a PNG of just that tile for the article. Run with:
//   npx tsx scripts/capture-mp-connections-tile.ts
import { chromium } from "playwright";
import path from "path";

const NAME = "Димитър Георгиев Димитров";
const OUT = path.resolve(
  "public/articles/images/connections/05-candidate-mini-graph.png",
);
const URL = `http://localhost:5173/candidate/${encodeURIComponent(NAME)}`;

const main = async (): Promise<void> => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    deviceScaleFactor: 2,
    // Force English locale via localStorage so labels match the article.
    locale: "en-US",
  });
  await context.addInitScript(() => {
    localStorage.setItem("language", "en");
  });
  const page = await context.newPage();
  page.on("console", (msg) =>
    console.log(`[browser ${msg.type()}]`, msg.text()),
  );
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60_000 });

  // Wait for the connections tile header to appear and the d3-force
  // simulation to settle (alpha decay 0.04 → ~1.5s to look stable).
  const heading = page
    .locator("h3")
    .filter({ hasText: /Connections to other MPs|Връзки с други депутати/ });
  await heading.first().waitFor({ state: "visible", timeout: 30_000 });
  const card = heading
    .first()
    .locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
  await page.waitForTimeout(3_500);
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  await card.screenshot({ path: OUT });
  console.log(`wrote ${OUT}`);
  await browser.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
