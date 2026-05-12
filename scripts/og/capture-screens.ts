// Playwright captures for the dashboard-type OG images. Run while the
// Vite dev server is up at http://localhost:5173:
//
//   npx tsx scripts/og/capture-screens.ts
//
// Each entry tells Playwright which selector to wait for, what to scroll
// to the top of the viewport, and which element's bounding box should
// anchor the 1200x630 OG clip. Pages whose hero IS the visual (e.g. a map
// or chart) center the clip on that element; pages whose visual is the
// page header use top-aligned clipping anchored on the H1.
import { chromium, Page } from "playwright";
import path from "path";
import fs from "fs";

const OG_W = 1200;
const OG_H = 630;
const DEV_URL = "http://localhost:5173";
const OUT_DIR = path.resolve("public/og");

type Capture = {
  slug: string; // output filename (slug.png in public/og/)
  routePath: string; // dev-server path, no leading slash
  // CSS selector to wait for before screenshotting. The page is given up to
  // 60s to render — pick something that only appears after data has loaded.
  waitFor: string;
  // CSS selector for the element to scroll to the top of the viewport AND
  // use as the clip anchor. Defaults to the waitFor selector.
  anchor?: string;
  // If true, the 1200x630 clip is centered on the anchor element (best for
  // maps/charts whose composition reads well from the middle). Otherwise the
  // clip is top-aligned with a small offset above the anchor.
  centerOnAnchor?: boolean;
  // Extra ms to wait after scrolling, so chart/map render settles.
  settleMs?: number;
  // Optional extra CSS to hide noisy chrome (popovers, tooltips, etc.).
  extraCss?: string;
};

const captures: Capture[] = [
  {
    slug: "risk-analysis",
    routePath: "risk-analysis",
    // CompositeIndexHero is the first card on the page; it always renders
    // once national_summary + risk score load.
    waitFor: '[data-og="composite-index-hero"]',
    anchor: '[data-og="composite-index-hero"]',
    settleMs: 2000,
  },
  {
    slug: "risk-score",
    routePath: "risk-score",
    waitFor: '[data-og="risk-score-page"]',
    anchor: '[data-og="risk-score-page"]',
    settleMs: 1500,
  },
  {
    slug: "benford",
    routePath: "benford",
    // The first Recharts surface inside a BenfordChart panel.
    waitFor: ".recharts-surface",
    anchor: ".recharts-wrapper",
    centerOnAnchor: true,
    settleMs: 1800,
  },
  {
    slug: "persistence",
    routePath: "persistence",
    waitFor: ".leaflet-container",
    anchor: ".leaflet-container",
    centerOnAnchor: true,
    settleMs: 2500,
  },
  {
    slug: "wasted-vote",
    routePath: "wasted-vote",
    waitFor: ".leaflet-container",
    anchor: ".leaflet-container",
    centerOnAnchor: true,
    settleMs: 2500,
  },
  {
    slug: "connections",
    routePath: "connections",
    // The d3-force layout renders to a canvas. Wait for it AND give the
    // simulation a few seconds to settle into a readable layout before
    // capturing.
    waitFor: "canvas",
    anchor: "canvas",
    centerOnAnchor: true,
    settleMs: 4500,
  },
];

const HIDE_CHROME_CSS = `
  nav.fixed{display:none!important;}
  header,header *{display:none!important;}
  body{padding-top:0!important;}
  /* Hover tooltips / popovers that may be in flight when the timer fires. */
  [role="tooltip"]{display:none!important;}
`;

const captureOne = async (page: Page, c: Capture): Promise<void> => {
  const url = `${DEV_URL}/${c.routePath}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  await page.addStyleTag({ content: HIDE_CHROME_CSS + (c.extraCss ?? "") });
  await page.waitForSelector(c.waitFor, { timeout: 30_000 });

  const anchorSel = c.anchor ?? c.waitFor;
  await page
    .locator(anchorSel)
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(c.settleMs ?? 2000);

  const box = await page.locator(anchorSel).first().boundingBox();
  if (!box) throw new Error(`anchor not found for ${c.slug}: ${anchorSel}`);

  let clipX: number;
  let clipY: number;
  if (c.centerOnAnchor) {
    clipX = Math.round(box.x + (box.width - OG_W) / 2);
    clipY = Math.round(box.y + (box.height - OG_H) / 2);
  } else {
    // Top-align the clip on the anchor, with a small top margin so the H1
    // isn't pinned right against the edge of the card.
    clipX = Math.round(box.x + (box.width - OG_W) / 2);
    clipY = Math.max(0, Math.round(box.y - 16));
  }

  const out = path.join(OUT_DIR, `${c.slug}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({
    path: out,
    clip: {
      x: Math.max(0, clipX),
      y: Math.max(0, clipY),
      width: OG_W,
      height: OG_H,
    },
  });
  console.log(
    `wrote ${out} (anchor=${anchorSel}, center=${!!c.centerOnAnchor})`,
  );
};

const filter = process.argv.slice(2);
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
  const items =
    filter.length > 0
      ? captures.filter((c) => filter.includes(c.slug))
      : captures;
  if (!items.length) {
    throw new Error(
      `no captures matched filter ${filter.join(", ")}. Known slugs: ${captures
        .map((c) => c.slug)
        .join(", ")}`,
    );
  }
  for (const c of items) {
    try {
      await captureOne(page, c);
    } catch (err) {
      console.error(`failed: ${c.slug}`, err);
      process.exitCode = 1;
    }
  }
  await browser.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
