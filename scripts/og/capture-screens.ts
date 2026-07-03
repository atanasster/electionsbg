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
  // Optional CSS selector to click after `waitFor` resolves but before
  // measuring/screenshotting. For pages where the chart is only rendered
  // after a user interaction (e.g. expanding the first accordion item).
  clickFirst?: string;
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
  {
    slug: "parliament-cohesion",
    routePath: "parliament/cohesion",
    // Cohesion screen leads with a Recharts line chart showing per-session
    // group discipline over time.
    waitFor: ".recharts-surface",
    anchor: ".recharts-wrapper",
    centerOnAnchor: true,
    settleMs: 2500,
  },
  {
    slug: "parliament-embedding",
    routePath: "parliament/embedding",
    // UMAP scatter — the chart IS the page. Center the clip on the recharts
    // wrapper so all clusters land in frame.
    waitFor: ".recharts-surface",
    anchor: ".recharts-wrapper",
    centerOnAnchor: true,
    settleMs: 2500,
  },
  {
    slug: "parliament",
    routePath: "parliament",
    // Hub has four tiles; the heatmap (correlation tile) has the most visual
    // weight at OG aspect ratio. Wait for any cell, then anchor the grid.
    waitFor: 'div[title*="↔"]',
    anchor: 'div[title*="↔"]',
    centerOnAnchor: true,
    settleMs: 2500,
  },
  {
    slug: "procurement",
    routePath: "procurement",
    // Wait for the stat cards grid (data-og="procurement-stats"), then anchor
    // on the flow tile (sankey) once it settles below the stats.
    waitFor: '[data-og="procurement-stats"]',
    anchor: '[data-og="procurement-flow"]',
    centerOnAnchor: true,
    settleMs: 3000,
  },
  {
    slug: "procurement-contractors",
    routePath: "procurement/contractors",
    // DataTable renders tbody rows once the JSON is fetched.
    waitFor: 'section[aria-label="top-contractors"] tbody tr',
    anchor: 'section[aria-label="top-contractors"]',
    settleMs: 1500,
  },
  {
    slug: "procurement-awarders",
    routePath: "procurement/awarders",
    waitFor: 'section[aria-label="top-awarders"] tbody tr',
    anchor: 'section[aria-label="top-awarders"]',
    settleMs: 1500,
  },
  {
    slug: "procurement-mps",
    routePath: "procurement/mps",
    // MP rows include avatars — give a bit more settle time for images. Page
    // also lists connected officials below the fold; the clip leads with MPs.
    waitFor: 'section[aria-label="top-mps"] tbody tr',
    anchor: 'section[aria-label="top-mps"]',
    settleMs: 2000,
  },
  {
    slug: "procurement-sectors",
    routePath: "procurement/sectors",
    // DataTable renders tbody rows once the JSON is fetched.
    waitFor: 'section[aria-label="procurement-sectors"] tbody tr',
    anchor: 'section[aria-label="procurement-sectors"]',
    settleMs: 1500,
  },
  // The remaining ProcurementNav sub-pages. All capture with ?pscope=all so the
  // frame shows the full corpus — the default `ns` scope is the *current*
  // parliament's contract window (only weeks old for NS 52), which would render
  // a near-empty table/diagram.
  {
    slug: "procurement-contracts",
    routePath: "procurement/contracts?pscope=all",
    // DataTable renders tbody rows once the corpus shard is fetched. Anchor on
    // the section so the clip leads with the summary strip (count / total /
    // EU% / flagged%) above the table.
    waitFor: 'section[aria-label="Договори"] tbody tr',
    anchor: 'section[aria-label="Договори"]',
    settleMs: 1800,
  },
  {
    slug: "procurement-flags",
    routePath: "procurement/flags?pscope=all",
    // Red-flag dashboard — 4 stat tiles + the per-oblast concentration heatmap.
    // Anchor on the section so the clip leads with the tiles and heatmap.
    waitFor: 'section[aria-label="procurement flags"] .grid',
    anchor: 'section[aria-label="procurement flags"]',
    settleMs: 2500,
  },
  {
    slug: "votes",
    // Representative recent session in NS 52 with a dozen items, so the
    // first-item hemicycle is well-populated.
    routePath: "votes/2026-05-07",
    waitFor: 'li[id^="item-"] button',
    // Expand the first item so SessionVoteHemicycle renders the SVG seats.
    clickFirst: 'li[id^="item-"] button',
    // Hemicycle SVG carries the i18n-driven aria-label; the page-chrome logo
    // also uses role="img", so target by aria-label to disambiguate.
    anchor: 'svg[aria-label^="Полукръг"]',
    centerOnAnchor: true,
    settleMs: 2500,
  },
  {
    slug: "budget",
    routePath: "budget",
    // BudgetFlowTile carries the most visual weight on the page — Sankey-like
    // flow + balance bridge — and lives below the headline stat cards.
    waitFor: '[data-og="budget-flow"]',
    anchor: '[data-og="budget-flow"]',
    centerOnAnchor: true,
    settleMs: 3000,
  },
  {
    slug: "budget-tax-calculator",
    routePath: "budget/tax-calculator",
    // The calculator's two-pane layout — inputs (profile, salary slider) on
    // the left, hero figures + tax-bill breakdown on the right. Top-aligned
    // so the clip leads with the inputs panel and headline numbers.
    waitFor: "#budget-tax-calculator",
    anchor: "#budget-tax-calculator",
    settleMs: 2500,
  },
  {
    slug: "indicators",
    routePath: "indicators",
    // KPI dashboard front door — 12 tiles in a responsive grid with sparklines
    // and rank badges. Top-aligned so the headline tiles (GDP, inflation,
    // unemployment, sentiment) land in frame; bottom rows clip off naturally.
    waitFor: '[data-og="indicators-kpi-grid"]',
    anchor: '[data-og="indicators-kpi-grid"]',
    settleMs: 2000,
  },
  {
    slug: "indicators-economy",
    routePath: "indicators/economy",
    // Economy headline multi-line chart (GDP / inflation / unemployment /
    // labour income), centered for the cleanest read of the cabinet bands.
    waitFor: ".recharts-surface",
    anchor: ".recharts-wrapper",
    centerOnAnchor: true,
    settleMs: 2500,
  },
  {
    slug: "indicators-fiscal",
    routePath: "indicators/fiscal",
    // Fiscal %-of-GDP multi-line chart leads the page (debt / balance /
    // current account).
    waitFor: ".recharts-surface",
    anchor: ".recharts-wrapper",
    centerOnAnchor: true,
    settleMs: 2500,
  },
  {
    slug: "indicators-governance",
    routePath: "indicators/governance",
    // CPI line chart leads the page; small Y-range means the chart fills the
    // frame well when centered.
    waitFor: ".recharts-surface",
    anchor: ".recharts-wrapper",
    centerOnAnchor: true,
    settleMs: 2500,
  },
  {
    slug: "indicators-society",
    routePath: "indicators/society",
    // 4-tile grid of small charts (youth unemployment / house prices / Gini /
    // poverty). Center on the grid container so all four land in frame.
    waitFor: ".recharts-surface",
    anchor: ".grid",
    centerOnAnchor: true,
    settleMs: 2500,
  },
  {
    slug: "indicators-compare",
    routePath: "indicators/compare",
    // EU compare dashboard hero — the WGI radar. Recharts polygons settle
    // after the data hook resolves; we wait for an SVG polygon (a Radar
    // shape) to appear inside the WGI section, then anchor on the section
    // itself so the radar + legend land in the clip.
    waitFor: '[data-og="eu-compare-wgi"] svg path',
    anchor: '[data-og="eu-compare-wgi"]',
    centerOnAnchor: true,
    settleMs: 2500,
  },
  {
    slug: "governance",
    routePath: "governance",
    // The budget-summary tile is the largest data-driven visual on the
    // governance dashboard (the rest are mostly stat cards + small SVGs).
    waitFor: '[data-og="budget-summary"]',
    anchor: '[data-og="budget-summary"]',
    centerOnAnchor: true,
    settleMs: 2500,
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

  if (c.clickFirst) {
    await page.locator(c.clickFirst).first().click();
    // Give React a moment to mount the newly-revealed sub-tree (e.g. the
    // hemicycle SVG) before we ask for its bounding box.
    await page.waitForSelector(c.anchor ?? c.waitFor, { timeout: 15_000 });
  }

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
