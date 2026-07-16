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
import { INSTITUTION_PACKS } from "../prerender/institutions";

const OG_W = 1200;
const OG_H = 630;
// Defaults to the standard Vite dev port; override with OG_BASE_URL when the
// dev server was auto-assigned a different port (matches screenshot_procurement.ts).
const DEV_URL = process.env.OG_BASE_URL ?? "http://localhost:5173";
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
  // When true, the clip's left edge is pinned to the anchor's left edge (minus
  // a small margin) instead of centered. Best for wide left-to-right content
  // (a table + KPI row) where the identity columns live on the left and the
  // trailing columns can clip off naturally. Ignored when centerOnAnchor.
  leftAlign?: boolean;
};

const captures: Capture[] = [
  {
    slug: "defense",
    routePath: "defense",
    // The %GDP-to-5% chart is the signature visual — static NATO data, always
    // renders. Wait for the Recharts surface (not just the container) so the
    // line + target reference lines are drawn before the clip.
    waitFor: '[data-og="defense-gdp-chart"] .recharts-surface',
    anchor: "#defense-gdp",
    centerOnAnchor: true,
    settleMs: 2500,
  },
  {
    slug: "water",
    routePath: "water",
    // The riverbed-cleaning tile (#flood) is static-data — always renders with
    // no /api/db dependency — and carries the headline € plus the year bars, so
    // it's a robust, self-contained OG hero for the water view.
    waitFor: "#flood",
    anchor: "#flood",
    centerOnAnchor: true,
    settleMs: 1500,
  },
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
    routePath: "procurement?pscope=all",
    // The redesigned hub is a tile grid (no more stat cards). Anchor on the
    // explore-tiles wrapper and top-align, so the card leads with the colourful
    // sub-page tiles + their headline numbers. ?pscope=all so the tiles carry
    // the full-corpus figures (the default `ns` scope is only weeks old).
    waitFor: '[data-og="procurement-hub"] a',
    anchor: '[data-og="procurement-hub"]',
    leftAlign: true,
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
    slug: "procurement-ngos",
    routePath: "procurement/ngos",
    // NGO browser — DbDataTable renders tbody rows once the first page loads.
    // Anchor on the section so the clip leads with the title + table.
    waitFor: 'section[aria-label="ngos"] tbody tr',
    anchor: 'section[aria-label="ngos"]',
    settleMs: 1800,
  },
  {
    slug: "procurement-appeals",
    routePath: "procurement/appeals?pscope=all",
    // КЗК appeals browser — DbDataTable renders tbody rows once the first page
    // loads. Anchor on the section so the clip leads with the title + table.
    waitFor: 'section[aria-label="appeals"] tbody tr',
    anchor: 'section[aria-label="appeals"]',
    settleMs: 1800,
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
    slug: "pensions",
    routePath: "pensions",
    // The "who pays for pensions" hero — the 46.8% state-transfer reframe and
    // the contributions/transfer proportion bar, the sharpest single image on
    // the page. Sits right below the KPI row.
    waitFor: '[data-og="pension-funding"]',
    anchor: '[data-og="pension-funding"]',
    centerOnAnchor: true,
    settleMs: 2500,
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
    slug: "financing",
    routePath: "financing?elections=2026_04_19",
    // Campaign-finance dashboard: 6 headline KPI tiles (total raised, donations,
    // top donor, self-funded %, media, agencies) sitting directly above the
    // parties table with its folded funding-mix bars. Top-aligned on the KPI
    // grid so the clip leads with the numbers and the colourful table below.
    waitFor: '[data-og="financing-hero"]',
    anchor: '[data-og="financing-hero"]',
    leftAlign: true,
    settleMs: 2000,
  },
  {
    slug: "judiciary",
    routePath: "judiciary",
    // The caseload-flow chart IS the page's argument (filed ≈ resolved, so the
    // backlog never drains) — centre the clip on it rather than the KPI row.
    waitFor: '[data-og="judiciary-caseload"] .recharts-surface',
    anchor: '[data-og="judiciary-caseload"]',
    centerOnAnchor: true,
    settleMs: 2500,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "culture",
    routePath: "culture",
    // KPI row + discipline-split bar + subsidy-by-year, top-aligned so the clip
    // leads with the headline numbers. Like the subsidies card, the full-bleed
    // dashboard is capped at 1216px so the grid is exactly 1200 and the outer
    // stat cards aren't sliced by the clip. (Per-capita map deferred to Phase 2.)
    waitFor: '[data-og="culture-hero"]',
    anchor: '[data-og="culture-hero"]',
    settleMs: 2500,
    extraCss:
      "[data-community-banner]{display:none!important;} main{max-width:1216px!important;}",
  },
  {
    slug: "education",
    routePath: "education",
    // The "score vs context" scatter (each dot a school, positioned by community
    // context vs matura, with the expectation line) is the signature visual.
    waitFor: '[data-og="context-scatter"] svg circle',
    anchor: '[data-og="context-scatter"]',
    centerOnAnchor: true,
    settleMs: 2500,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "subsidies",
    routePath: "subsidies",
    // KPI row (paid / recipients / top-100 share / largest scheme) sitting above
    // the concentration bar + scheme ranking. Top-aligned on the KPI grid so the
    // clip leads with the headline numbers and carries the distribution tiles.
    // The dashboard shell is full-bleed, so at the 1280px capture viewport the
    // KPI grid is 1249px wide and the outer stat cards get sliced by the 1200px
    // clip. Capping <main> at 1216px (grid + its 2x8px padding) makes the grid
    // exactly 1200 so the clip frames it edge to edge. The viewport itself stays
    // 1280, so the xl: two-column distribution grid below survives.
    waitFor: '[data-og="subsidies-hero"]',
    anchor: '[data-og="subsidies-hero"]',
    settleMs: 2500,
    extraCss:
      "[data-community-banner]{display:none!important;} main{max-width:1216px!important;}",
  },
  {
    slug: "governance",
    routePath: "governance",
    // /governance is now the Управление tile-hub — lead the card with the first
    // cluster of sub-hub tiles (like the sectors hub), not the old dashboard.
    waitFor: '[data-og="governance-hub"] a',
    anchor: '[data-og="governance-hub"]',
    leftAlign: true,
    settleMs: 2500,
  },
  {
    slug: "governance-overview",
    routePath: "governance/overview",
    // The former governance dashboard (moved to /overview). The budget-summary
    // tile is its largest data-driven visual.
    waitFor: '[data-og="budget-summary"]',
    anchor: '[data-og="budget-summary"]',
    centerOnAnchor: true,
    settleMs: 2500,
  },
  {
    slug: "governance-declarations",
    routePath: "governance/declarations",
    // The Декларации sub-hub tile grid.
    waitFor: '[data-og="declarations-hub"] a',
    anchor: '[data-og="declarations-hub"]',
    leftAlign: true,
    settleMs: 2500,
  },
  {
    slug: "governance-sectors",
    routePath: "governance/sectors?pscope=all",
    // The 15-sector tile hub. Anchor on the tiles wrapper and top-align so the
    // card leads with the first cluster of infographic tiles + their headline
    // numbers (payouts / procurement € / matura score). ?pscope=all for the
    // full-corpus figures on the tender-driven sectors.
    waitFor: '[data-og="sectors-hub"] a',
    anchor: '[data-og="sectors-hub"]',
    leftAlign: true,
    settleMs: 3000,
  },
  {
    slug: "parliament-attendance",
    routePath: "parliament/attendance",
    // Per-MP attendance ranking (surfaced from the parliament hub). The anchor
    // wraps the tall list from the top, so top-align (no centerOnAnchor) to keep
    // the clip inside the viewport and lead with the heading + first rows.
    waitFor: '[data-og="attendance"]',
    anchor: '[data-og="attendance"]',
    leftAlign: true,
    settleMs: 2500,
  },
];

// Packed institution awarder pages (/awarder/:eik) — АПИ (roads), НОИ, НЗОК and
// ДФЗ. One OG card each, written to public/og/awarder/<slug>.png (the path the
// prerender's ogImage points at). The card frames each pack's signature visual
// (the roads network map, the ДОО fund-flow bar, the НЗОК budget bridge, the
// money-flow Sankey) via the pack's `ogAnchor` — so the card leads with a chart
// or map, not a plain KPI header. The awarder page reads from the DB, so the
// dev server's /api/db backend must be up (same as the procurement captures).
for (const inst of INSTITUTION_PACKS) {
  captures.push({
    slug: `awarder/${inst.slug}`,
    // The awarder page's scope control already defaults to the full corpus
    // ("all"), so no ?pscope override is needed for the card to show all years.
    routePath: `awarder/${inst.eik}`,
    // Wait on the pack's hero visual itself — it renders once the (lazy) pack
    // component has loaded the buyer's contract corpus.
    waitFor: inst.ogAnchor,
    anchor: inst.ogAnchor,
    centerOnAnchor: inst.ogCenter,
    // Full-width hero cards read best pinned to their left edge (a centered
    // clip on a wide card slices content off both sides). Skipped when the pack
    // opts into centered framing (a map/chart that reads from the middle).
    leftAlign: !inst.ogCenter,
    // Hide the community/news banner above the page header — it isn't part of
    // the pack visual and can steal vertical space when the card sits high.
    extraCss: "[data-community-banner]{display:none!important;}",
    settleMs: inst.ogSettleMs ?? 2500,
  });
}

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
    clipX = c.leftAlign
      ? Math.round(box.x - 12)
      : Math.round(box.x + (box.width - OG_W) / 2);
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
