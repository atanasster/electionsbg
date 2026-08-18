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

// The viewport for an `anchor: "h1"` capture. The content column tracks the
// viewport width, so at the shared 1280 it is ~1264 and a 1200 clip centred on
// it shaves ~32px off BOTH sides — measured, /funds/beneficiaries lost the first
// two letters of its breadcrumb on the left and the last money column on the
// right. At 1200 the column fits the clip with margin to spare. This is the same
// "the layout, not the content, is what the crop is fighting" case the
// `viewport` field documents, with the fix at the other end of the range.
const OG_CLIP_VIEWPORT = { width: 1200, height: 1400 };

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
  // Per-capture viewport override, applied for this entry and reset afterwards.
  // The shared context is 1280 wide, which is exactly Tailwind's `xl` breakpoint —
  // so a responsive tile grid renders FOUR columns there and a 1200px clip slices
  // the fourth one vertically down the middle. Dropping below 1280 gives three
  // full-width columns that fit the clip exactly. Use when the page's layout, not
  // its content, is what the crop is fighting.
  viewport?: { width: number; height: number };
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
    slug: "polls",
    routePath: "polls",
    // The poll-accuracy trends chart is the page hero.
    waitFor: ".recharts-surface",
    anchor: ".recharts-wrapper",
    centerOnAnchor: true,
    settleMs: 1800,
  },
  {
    slug: "compare",
    routePath: "compare?elections=2026_04_19",
    // Default "elections" mode — the two-election comparison table (renders only
    // once both national summaries load, so the anchor's presence means data).
    waitFor: '[data-og="compare-table"]',
    anchor: '[data-og="compare-table"]',
    leftAlign: true,
    settleMs: 2500,
  },
  // Reports-hub tile destinations — each is the report's results table. One card
  // per report type (the /og/reports-<slug>.png the report routes reference),
  // captured at the grain the hub tile links to. recount + flash-memory use a
  // cycle that actually has them (2024_10_27); the rest use the latest.
  //
  // All ten take `viewport: OG_CLIP_VIEWPORT` and NOT leftAlign, which is the
  // opposite of what this table shape usually wants — and the exception is the
  // whole point. `ReportTemplate` renders the shared columns and then appends
  // `...extraColumns`, so the ONE column that distinguishes a report
  // (voterTurnout, pctInvalidBallots, recount, pctSupportsNoOne …) is always the
  // rightmost. leftAlign clips from the anchor's left edge and lets the trailing
  // columns fall off "naturally" — which here throws away the column the card
  // exists to show. Measured: reports-turnout carried ПАРТИЯ / ОБЛАСТ / ОБЩИНА /
  // ОБЩО ГЛАСОВЕ / % and no turnout at all. At a 1200 viewport the table is
  // 1182px wide, so a centred clip covers it end to end.
  {
    slug: "reports-concentrated",
    routePath: "reports/settlement/concentrated?elections=2026_04_19",
    waitFor: '[data-og="report-table"] table',
    anchor: '[data-og="report-table"]',
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
  },
  {
    slug: "reports-additional_voters",
    routePath: "reports/settlement/additional_voters?elections=2026_04_19",
    waitFor: '[data-og="report-table"] table',
    anchor: '[data-og="report-table"]',
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
  },
  {
    slug: "reports-supports_no_one",
    routePath: "reports/settlement/supports_no_one?elections=2026_04_19",
    waitFor: '[data-og="report-table"] table',
    anchor: '[data-og="report-table"]',
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
  },
  {
    slug: "reports-turnout",
    routePath: "reports/municipality/turnout?elections=2026_04_19",
    waitFor: '[data-og="report-table"] table',
    anchor: '[data-og="report-table"]',
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
  },
  {
    slug: "reports-invalid_ballots",
    routePath: "reports/settlement/invalid_ballots?elections=2026_04_19",
    waitFor: '[data-og="report-table"] table',
    anchor: '[data-og="report-table"]',
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
  },
  {
    slug: "reports-top_gainers",
    routePath: "reports/municipality/top_gainers?elections=2026_04_19",
    waitFor: '[data-og="report-table"] table',
    anchor: '[data-og="report-table"]',
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
  },
  {
    slug: "reports-top_losers",
    routePath: "reports/municipality/top_losers?elections=2026_04_19",
    waitFor: '[data-og="report-table"] table',
    anchor: '[data-og="report-table"]',
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
  },
  {
    slug: "reports-recount",
    routePath: "reports/section/recount?elections=2024_10_27",
    waitFor: '[data-og="report-table"] table',
    anchor: '[data-og="report-table"]',
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
  },
  {
    slug: "reports-missing_flash_memory",
    routePath: "reports/section/missing_flash_memory?elections=2024_10_27",
    waitFor: '[data-og="report-table"] table',
    anchor: '[data-og="report-table"]',
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
  },
  {
    slug: "party-demographics",
    routePath: "party-demographics?elections=2026_04_19",
    // The cleavages dot-plot hero (all census metrics × 4%+ parties).
    waitFor: '[data-og="party-demographics"] a',
    anchor: '[data-og="party-demographics"]',
    leftAlign: true,
    settleMs: 2500,
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
    slug: "demographics",
    routePath: "demographics",
    // The census choropleth map (first leaflet map on the page).
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
    //
    // At the shared 1280 viewport the wrapper is 1230px, so a centred 1200 clip
    // starts at x=40 — and the legend and the party pills both live hard against
    // the chart's left edge, so both were sliced. At 1200 the wrapper is narrower
    // than the clip, which pins clipX to 0 and keeps them whole. The pan/zoom
    // pad is hidden: a still card cannot be panned, and it read as chart furniture.
    waitFor: ".recharts-surface",
    anchor: ".recharts-wrapper",
    centerOnAnchor: true,
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
    extraCss: "[data-og-chrome]{display:none!important;}",
  },
  {
    slug: "parliament",
    routePath: "parliament",
    // The rebuilt hub is a session strip over a tile grid. This entry used to wait
    // for `div[title*="↔"]` — a cell inside the party-correlation heatmap tile,
    // which the rebuild removes — so it would have waited the full 60 s and failed
    // with nothing on the page to explain why. Anchor on the hub wrapper and
    // left-align, mirroring the procurement entry, so the card leads with the strip
    // and the first tiles rather than a crop of one card's interior.
    waitFor: '[data-og="parliament-hub"] a',
    anchor: '[data-og="parliament-hub"]',
    leftAlign: true,
    // Below `xl`, so the explore band is three full-width tiles rather than four
    // that the 1200px clip would cut through. §9.4 of the plan exists because the
    // previous card was a crop taken mid-card; reproducing that with a different
    // tile would have missed the point.
    viewport: { width: 1180, height: 1100 },
    settleMs: 3000,
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
    // Was `tbody tr` until this list became cards rather than a table, which
    // timed the capture out on every run — and a failed capture leaves the old
    // card in place, so nothing surfaced it. `data-og` sits on the data-gated
    // branch in ProcurementSectorsScreen, so it cannot catch the placeholder.
    waitFor: '[data-og="procurement-sectors"]',
    viewport: OG_CLIP_VIEWPORT,
    anchor: 'section[aria-label="procurement-sectors"]',
    settleMs: 1500,
  },
  {
    // The persons browser. Anchored on the section so the frame leads with the KPI strip
    // and the "Основна принадлежност" bar above the table, the same composition the
    // procurement captures use.
    slug: "persons",
    routePath: "persons",
    waitFor: 'section[aria-label="persons"] tbody tr',
    anchor: 'section[aria-label="persons"]',
    // leftAlign, like the other full-width sections: the strip is wider than the 1200px
    // clip, so a centred crop slices content off BOTH edges (it cut "Един" to "дин" and
    // "Лица" to "ица" on the first capture).
    leftAlign: true,
    settleMs: 1800,
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
    // The section's aria-label was the Bulgarian "Договори" and is now the
    // stable "contracts" — a rename that silently broke this capture (card
    // frozen 22 June). Prefer the non-localized label: an aria-label that is
    // display copy will drift again.
    waitFor: 'section[aria-label="contracts"] tbody tr',
    anchor: 'section[aria-label="contracts"]',
    viewport: OG_CLIP_VIEWPORT,
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
    slug: "procurement-overview",
    routePath: "procurement/overview",
    // The hub's „Обзор" tile destination — a KPI dashboard, so the card is
    // title → scope chip → the four headline figures. Waits on the KPI text
    // rather than a table row: this page has no table.
    waitFor: 'section[aria-label="Обществени поръчки — обзор"]',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
  },
  {
    // anchor h1 so the clip leads with the „вписана роля, не собственост" caveat —
    // on a page about named people that limit has to be in the share card, not
    // below the fold.
    slug: "subsidies-political",
    routePath: "subsidies/political?pscope=all",
    waitFor: '[data-og="subsidies-political"]',
    anchor: "h1",
    settleMs: 2500,
    extraCss:
      "[data-community-banner]{display:none!important;} main{max-width:1216px!important;}",
  },
  {
    // Same reason: the „трите колони не се събират" box is the page's argument and
    // must survive into the card.
    slug: "subsidies-cross-programme",
    routePath: "subsidies/cross-programme?pscope=all",
    waitFor: '[data-og="subsidies-cross-programme"]',
    anchor: "h1",
    settleMs: 2500,
    extraCss:
      "[data-community-banner]{display:none!important;} main{max-width:1216px!important;}",
  },
  {
    // The four headline cards ARE the argument: the share, the name count, the row
    // count and — the one that stops the misreading — how much of it is plainly a
    // company. anchor h1 so the clip leads with the „no ЕИК is not a person" line.
    slug: "subsidies-untraceable",
    routePath: "subsidies/untraceable?pscope=all",
    waitFor: '[data-og="subsidies-untraceable"]',
    anchor: "h1",
    settleMs: 2500,
    extraCss:
      "[data-community-banner]{display:none!important;} main{max-width:1216px!important;}",
  },
  {
    // The year table with its gaps is the whole page — the missing rows are the
    // content, so the clip has to include them rather than stopping at the intro.
    slug: "subsidies-coverage",
    routePath: "subsidies/coverage",
    waitFor: '[data-og="subsidies-coverage"] tbody tr',
    anchor: '[data-og="subsidies-coverage"]',
    settleMs: 2000,
    extraCss:
      "[data-community-banner]{display:none!important;} main{max-width:1216px!important;}",
  },
  {
    // The ranking IS the page — anchor on the h1 so the clip reads title → the
    // "ЕИК only" caveat → the first rows, the recipe the skill gives for a ranked
    // list. Paired with the capped content column so the 1200 clip does not shave
    // both sides of a full-bleed table.
    slug: "subsidies-recipients",
    routePath: "subsidies/recipients?pscope=all",
    waitFor: "tbody tr",
    anchor: "h1",
    settleMs: 2500,
    extraCss:
      "[data-community-banner]{display:none!important;} main{max-width:1216px!important;}",
  },
  {
    // The three-fund split is what this page adds over the hub's old bar list, so
    // the clip leads with it rather than with the scheme table.
    slug: "subsidies-schemes",
    routePath: "subsidies/schemes?pscope=all",
    waitFor: '[data-og="subsidies-schemes-pillars"]',
    anchor: "h1",
    settleMs: 2500,
    extraCss:
      "[data-community-banner]{display:none!important;} main{max-width:1216px!important;}",
  },
  {
    // anchor: "h1" and NOT centerOnAnchor. The tier bar is the page's argument,
    // but it is the left cell of an xl two-column grid — centring the 1200 clip on
    // it shifted the frame left and sliced the „Топ 100" card off the right edge.
    // Anchoring on the h1 lets the clip fall over the whole band.
    slug: "subsidies-concentration",
    routePath: "subsidies/concentration?pscope=all",
    waitFor: '[data-og="subsidies-concentration"] ul li',
    anchor: "h1",
    settleMs: 2500,
    extraCss:
      "[data-community-banner]{display:none!important;} main{max-width:1216px!important;}",
  },
  {
    // The choropleth IS this page's argument — it is the whole reason the page
    // exists (the map moved off /subsidies to stop it costing every hub visitor
    // 407 KB). Anchor on the map itself rather than the KPI row above it, and
    // wait for a rendered <path> so the clip is not a screenshot of an empty
    // SVG container: the GeoJSON arrives after mount.
    slug: "subsidies-places",
    routePath: "subsidies/places",
    waitFor: '[data-og="subsidies-places-map"] svg path',
    anchor: '[data-og="subsidies-places-map"]',
    centerOnAnchor: true,
    settleMs: 2500,
    // The content column is capped to 1216 so the 1200 clip does not slice the
    // card's own edges — the first shot cut „Кликни" to „икни" on the left and lost
    // the share column on the right, because centring on a full-bleed anchor centres
    // on a box WIDER than the clip. Same trick the culture and subsidies cards use.
    extraCss:
      "[data-community-banner]{display:none!important;} main{max-width:1216px!important;}",
  },
  {
    slug: "subsidies-browse",
    routePath: "subsidies/browse",
    // The ДФЗ payments table. Scoped to the section like its DbDataTable
    // siblings, and to a DATA row (`tr.group`) — the error and empty branches
    // render a TableRow too. Top-aligned on `h1` so the card carries the title,
    // the basis line („изплатени … сумите са в евро"), the scope controls and
    // the row count before the first payments.
    waitFor: 'section[aria-label="subsidies"] tbody tr.group',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "sector-administration-services",
    routePath: "sector/administration/services",
    // The ИИСДА services catalogue — a long table with no KPI row, so the card
    // is title → breadcrumb → the filter row carrying the total → the first
    // services. Waits on a DATA row (`tr.group`), not the `h1` and not a bare
    // `tbody tr`: the heading renders before the fetch resolves, and DbDataTable
    // puts a TableRow in its error and empty branches too, so the looser
    // selector would shoot „Could not load data." and report success.
    waitFor: "tbody tr.group",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "sofia-companies",
    routePath: "sofia/companies",
    // Companies registered in Sofia holding a gated registry link to a public
    // figure. Top-aligned on `h1` so the clip reads title → the sentence that
    // states the basis (a manager/owner role in the Commerce Registry) → the
    // first company cards. That sentence is the whole point of the card: without
    // it a grid of names beside people's names reads as an accusation.
    //
    // Waits on a /company/ link rather than the `h1`: the heading and the lede
    // render before the fetch resolves, so anchoring the wait on chrome would
    // shoot the six-card skeleton on a slow response.
    waitFor: 'a[href^="/company/"]',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
  },
  {
    slug: "procurement-tenders",
    routePath: "procurement/tenders?pscope=all",
    // The tenders browser. It DOES carry `section[aria-label="tenders"]` like its
    // siblings below, but anchoring there would start the clip at the table and
    // drop the title, the scope chip and all four KPIs, which sit above it. So
    // this is a top-aligned `h1` clip like
    // the /budget hub: title → scope chip → the four KPIs (прогнозна стойност,
    // процедури, пряко/без обявление, ЕС-финансирани) → the procedure-type bar →
    // the first table rows. Centring instead would land mid-table with the KPIs
    // — the only figures on the page — cut off above the frame. The wait is on a
    // DATA row (`tr.group`); DbDataTable renders a TableRow in its error and
    // empty branches too, so a bare `tbody tr` would accept a failed fetch.
    waitFor: 'section[aria-label="tenders"] tbody tr',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
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
    // Was anchored on BudgetFlowTile's `budget-flow`, which LEFT this page when
    // /budget became a tile hub — the anchor still exists in that component,
    // just not here, so the capture timed out and the card stayed frozen at
    // 15 May. That anchor now captures `budget-deep-dive` above, which is the
    // page the tile moved to.
    //
    // Now the hub's own anchor, and top-aligned on `h1` rather than centred on
    // the tile grid: centring on a 2,000px-tall hub lands the clip mid-grid,
    // with the first tile column sliced off the left and the fourth off the
    // right and no title anywhere in frame. Top-aligned it reads title → intro
    // → the first band of tiles, which is what a hub is.
    waitFor: '[data-og="budget-hub"]',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
  },
  {
    slug: "budget-deep-dive",
    routePath: "budget/deep-dive",
    // THE CARD /budget/deep-dive DESERVES, and the one it could not have until
    // now. It shared /og/budget.png — the hub's tile grid — so the picture a
    // reader shared of „the deep dive" was the page it tells them it is NOT.
    // The `budget-flow` anchor is what used to capture the hub, and it LEFT
    // /budget for this page when the hub shipped.
    //
    // Top-aligned rather than centred: the tile is 1184x829, so centring lands
    // the clip mid-Sankey and drops both the heading and the three totals
    // (приход / разход / дефицит) that sit above it. Top-aligned it reads
    // title → what the graphic shows → the three figures → the flow itself.
    //
    // ⚠️ `svg text`, and BOTH halves of that are load-bearing.
    //
    // Not a bare `svg path`: that is satisfied the instant the card paints,
    // because the CardTitle renders <GitFork/>, a lucide icon whose own node
    // list contains two <path>s. `BudgetFlowGraphic` renders later still — it
    // is gated on a ResizeObserver setting width > 0, i.e. a second pass — so
    // the loose selector left only settleMs between this card and a shot of an
    // empty tile.
    //
    // And not the obvious fix either. The Sankey's links are the only paths
    // carrying `stroke="url(#…-grad-N)"`, so `path[stroke^="url("]` is exactly
    // the right SET — 35 of them — but every one is `fill="none"`, and
    // `waitForSelector` waits for VISIBILITY. Measured: it resolved the locator
    // 64 times and timed out at 30 s. `<text>` is Sankey-only under this anchor
    // (lucide icons carry none), renders on the same pass as the links, and is
    // visible.
    waitFor: '[data-og="budget-flow"] svg text',
    anchor: '[data-og="budget-flow"]',
    // The five drill-down triggers are a dead affordance in a static card and
    // wrap onto a second row, pushing the graphic down. Hiding them brings the
    // hatched deficit wedge into frame — which matters because the intro line
    // ABOVE it says „щрихованият клин е разликата, покривана с финансиране",
    // and a card that says that while cropping the wedge describes a picture it
    // does not show. The Legend is not a button and stays.
    extraCss: '[data-og="budget-flow"] button{display:none!important;}',
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3500,
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
    // EU compare dashboard hero — the WGI radar. Anchor on the section so the
    // radar grid + legend land in the clip.
    //
    // The waitFor was `svg path`, which MATCHED 32 elements and picked the first
    // — a `recharts-polar-grid-concentric-polygon` drawn at radius 0, i.e. a
    // zero-area path that is never `visible`. So this capture timed out on every
    // run since it was written, and because a failed capture leaves the previous
    // file on disk, the card just kept serving: public/og/indicators-compare.png
    // was dated 23 May while the rest of the directory had moved on, showing a
    // section that is no longer even the anchor. A failing entry and a working
    // one look identical from the outside — the only tell is the file's date.
    //
    // `.recharts-surface` inside the section is both visible and a data signal:
    // EuCompareWgiSmallMultiples returns null while `rows.length === 0`.
    waitFor: '[data-og="eu-compare-wgi"] .recharts-surface',
    anchor: '[data-og="eu-compare-wgi"]',
    centerOnAnchor: true,
    // Same 1264-vs-1200 arithmetic as the h1 entries below: centred on a
    // full-width section the clip loses 32px off each side, which took the
    // explainer's first characters and a third of the last radar.
    viewport: OG_CLIP_VIEWPORT,
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
    slug: "simulator",
    routePath: "simulator?elections=2026_04_19",
    // The coalition seat strip — the 240-mandate bar with the dashed 121-majority
    // marker — sitting above the ranked party/seat table. Top-aligned so the clip
    // leads with the strip and carries the party rows below it. (Was a rendered
    // text card in generate.ts; that job is removed so postbuild doesn't overwrite
    // this screenshot in dist/og — same reason /financing has none.)
    waitFor: '[data-og="simulator-hero"]',
    anchor: '[data-og="simulator-hero"]',
    settleMs: 1500,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "sofia",
    routePath: "sofia?elections=2026_04_19",
    // KPI row (top gainer / loser / turnout / paper-vs-machine) above the Sofia
    // section map. Top-aligned on the dashboard section so the clip leads with the
    // headline numbers and carries the map below. Wait for a loaded Leaflet tile so
    // the map isn't captured blank. (Was a rendered text card — job removed from
    // generate.ts.)
    waitFor: ".leaflet-tile-loaded",
    anchor: '[data-og="sofia-hero"]',
    settleMs: 2500,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "consumption",
    routePath: "consumption?elections=2026_04_19",
    // The Потребление hub is a launcher (product search + a grid of coloured
    // section tiles). Top-aligned on the tile grid so the clip shows the view's
    // breadth. (Was a rendered text card — job removed from generate.ts.)
    waitFor: '[data-og="consumption-hub"]',
    anchor: '[data-og="consumption-hub"]',
    settleMs: 1500,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "mp-assets",
    routePath: "mp-assets?elections=2026_04_19",
    // MP net-worth leaderboard (richest first) — avatar + name rows with the
    // declared net-worth column. Anchor on the page root so the clip leads with
    // the title and the top-ranked avatar rows; extra settle for the photos.
    // (Was a rendered text card — job removed from generate.ts.)
    //
    // SINCE THE GROUP CHART LANDED, the top of that clip is the per-party bars
    // rather than the first table rows — the same trade /parliament/attendance
    // makes deliberately, and the better thumbnail. `waitFor` deliberately stays
    // on the table: the chart renders only for the CURRENT parliament (see
    // AssetsByGroup), so waiting on it would turn "the pinned election is no
    // longer the sitting one" into a failed capture instead of the previous card.
    waitFor: '[data-og="mp-assets-og"] tbody tr',
    anchor: '[data-og="mp-assets-og"]',
    leftAlign: true,
    settleMs: 2500,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "mp-cars",
    routePath: "mp-cars?elections=2026_04_19",
    // MP declared-cars leaderboard (most valuable first) — avatar rows with make/
    // model and declared value, led by the total-fleet summary line. (Was a
    // rendered text card — job removed from generate.ts.)
    waitFor: '[data-og="mp-cars-og"] tbody tr',
    anchor: '[data-og="mp-cars-og"]',
    leftAlign: true,
    settleMs: 2500,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "crypto",
    routePath: "declarations/crypto",
    // The declared-crypto register, most valuable holding first. No ?elections= — the
    // page has no parliament scope: its rows are declarants across every tier, keyed on
    // the filing year, so pinning an election would seed a param the screen ignores.
    waitFor: '[data-og="crypto-registry-og"] tbody tr',
    anchor: '[data-og="crypto-registry-og"]',
    leftAlign: true,
    settleMs: 2500,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "mp-companies",
    routePath: "mp/companies?elections=2026_04_19",
    // MP-connected companies (most MPs first) — company rows with their linked-MP
    // avatars. (Was a rendered text card — job removed from generate.ts.)
    waitFor: '[data-og="mp-companies-og"] tbody tr',
    anchor: '[data-og="mp-companies-og"]',
    leftAlign: true,
    settleMs: 2500,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "officials-assets",
    routePath: "officials/assets?elections=2026_04_19",
    // Officials net-worth leaderboard (ministers / agency heads / governors),
    // richest first — name + category rows with the declared net-worth column.
    // (Was a rendered text card — job removed from generate.ts.)
    waitFor: '[data-og="officials-assets-og"] tbody tr',
    anchor: '[data-og="officials-assets-og"]',
    leftAlign: true,
    settleMs: 2500,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "observations",
    routePath: "observations",
    // OSCE/ODIHR observation reports — dated report cards with the mission-type
    // badge and the AI summary. Anchor on the ArticleLayout <article> so the clip
    // leads with the title + intro + the first report card; wait for the loaded
    // list (not the skeleton). HIDE_CHROME_CSS blanks every <header> (to drop the
    // site nav), which also hides ArticleLayout's own header (the title) — so
    // re-reveal just this article's header. (Was a rendered text card — job
    // removed from generate.ts.)
    waitFor: '[data-og="observations-list"]',
    anchor: "article",
    settleMs: 1500,
    extraCss:
      "[data-community-banner]{display:none!important;}" +
      " article header{display:block!important;}" +
      " article header h1,article header p{display:revert!important;}",
  },
  {
    slug: "council",
    routePath: "council",
    // The page is a coverage statement plus a ranked list, not a chart, so the
    // skill's list recipe applies: anchor on the h1 (HIDE_CHROME_CSS drops the
    // site header, so the h1 IS the top of the page) and let the clip read
    // title -> coverage -> the first councils. No leftAlign — that pins to the
    // h1's own left edge rather than the content column's.
    //
    // waitFor names a row LINK, which only exists after /api/db/council-overview
    // resolves. A container selector would match an empty shell and produce a
    // screenshot of a skeleton.
    waitFor: 'a[href^="/council/"]',
    anchor: "h1",
    settleMs: 1200,
    viewport: OG_CLIP_VIEWPORT,
    extraCss: "[data-community-banner]{display:none!important;}",
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
    // Wait on the plot but anchor on its CARD, top-aligned: the row is ~640px
    // tall (the over-performers list beside it runs to 18 names on lg), so
    // centring on the plot alone pushed both tile titles off the top and left
    // the card's empty search box underneath in frame.
    waitFor: '[data-og="context-scatter"] svg circle',
    anchor: '[data-og="context-scatter-card"]',
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
    slug: "reports-hub",
    routePath: "parliamentary/reports",
    // The anomaly-reports tile hub. Anchor on the tiles wrapper and top-align so
    // the card leads with the first cluster of report tiles.
    waitFor: '[data-og="reports-hub"] a',
    anchor: '[data-og="reports-hub"]',
    leftAlign: true,
    settleMs: 3000,
  },
  {
    slug: "analysis-hub",
    routePath: "parliamentary/analysis",
    // The election-analysis tile hub. Anchor on the tiles wrapper and top-align
    // so the card leads with the first cluster of infographic tiles + their
    // headline numbers (critical sections / Benford-flagged parties / wasted
    // share / stay-rate).
    waitFor: '[data-og="analysis-hub"] a',
    anchor: '[data-og="analysis-hub"]',
    leftAlign: true,
    settleMs: 3000,
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
    // Per-MP attendance ranking (surfaced from the parliament hub). Anchored on
    // `h1` and top-aligned, the clip reads title → intro → the by-group bar
    // chart, which is the page's argument in one picture.
    //
    // It used to anchor on `[data-og="attendance"]` with leftAlign, i.e. on the
    // MP list — a card of eight names with every percentage clipped off the
    // right edge, so the share image carried no number at all. The bar chart is
    // both the better visual and self-contained.
    //
    // `waitFor` names an `li` inside the chart: the section renders only when
    // the attendance file has loaded and folds to at least one group, so the
    // capture cannot photograph the skeleton.
    waitFor: '[data-og="attendance-groups"] li',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
    extraCss: "[data-community-banner]{display:none!important;}",
  },

  // ---------------------------------------------------------------------------
  // The 26 pages that were still falling through to the site-wide OG card. They
  // clustered by FAMILY — every /funds sub-page, five /budget, both
  // /demographics — which is the tell that nobody forgets one page, they forget
  // a module.
  //
  // Two recipes, and the choice is per page rather than per family:
  //   • a chart or map hero      → anchor on the visual, centerOnAnchor
  //   • a ranked list or a table → anchor on `h1`, top-aligned
  // `h1` is the right anchor for the second kind because HIDE_CHROME_CSS drops
  // the site header, so `h1` is the top of the page: the clip then reads title →
  // intro → the first rows, which is what the page is. It is full-width (1264px
  // measured), so the default centered clipX lands at 40 and the card keeps the
  // whole content column. Do NOT add leftAlign to an h1-anchored entry — it
  // pins the clip to the h1's own left edge, which is not the content's.
  //
  // Every `waitFor` names something that exists only once DATA is in hand (a
  // populated-branch `data-og`, a row link, a recharts surface). A container
  // that mounts empty would let the capture photograph the skeleton.
  // ---------------------------------------------------------------------------

  // --- /funds sub-pages -------------------------------------------------------
  {
    slug: "funds-places",
    routePath: "funds/places",
    // The município choropleth IS the page — centre the clip on it.
    waitFor: ".leaflet-container",
    anchor: ".leaflet-container",
    centerOnAnchor: true,
    settleMs: 3000,
  },
  {
    slug: "funds-absorption",
    routePath: "funds/absorption",
    // The money-flow Sankey. Matched on aria-label rather than on a class, so a
    // Recharts/D3 swap underneath does not silently reframe the card.
    waitFor:
      'svg[aria-label*="Поток на парите"], svg[aria-label*="Money flow"]',
    anchor: 'svg[aria-label*="Поток на парите"], svg[aria-label*="Money flow"]',
    centerOnAnchor: true,
    settleMs: 3000,
  },
  {
    slug: "funds-beneficiaries",
    routePath: "funds/beneficiaries",
    waitFor: '[data-og="funds-beneficiaries"]',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "funds-programmes",
    routePath: "funds/programmes",
    // The row links prove the 47 programmes have loaded.
    waitFor: 'a[href^="/funds/programme/"]',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "funds-dual-corpus",
    routePath: "funds/dual-corpus",
    waitFor: '[data-og="funds-dual-corpus"]',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "funds-interreg",
    routePath: "funds/interreg",
    waitFor: '[data-og="funds-interreg"]',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "funds-focus-index",
    routePath: "funds/focus",
    // NOT `funds-focus` — that slug is the per-THEME card (screenshot_funds.ts
    // shoots it off /funds/focus/guest-houses) which every /funds/focus/<slug>
    // child already references. The index had no card of its own: the children
    // were shareable and the page they hang off was not.
    waitFor: 'a[href^="/funds/focus/"]',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2000,
  },
  {
    slug: "funds-calls",
    routePath: "funds/calls",
    // /funds/calls was the one route in the repo whose declared ogImage pointed
    // at a file that had never been written: screenshot_funds.ts carried the
    // spec and nobody had run it, so both language variants shipped an og:image
    // that 404s. That spec is gone — it clipped {x:0,y:0} with the site header
    // still in the DOM, so its card was chrome down to the fold.
    // The rows arrive from /api/db/table after the shell paints, so wait on a
    // row and not on the heading.
    waitFor: "table tbody tr",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },

  // --- /budget sub-pages ------------------------------------------------------
  {
    slug: "budget-revenue",
    routePath: "budget/revenue",
    // Scoped to the section: an unscoped `ul > li` also matches the nav, which
    // HIDE_CHROME_CSS hides from view but leaves in the DOM.
    waitFor: '[data-og="budget-revenue"] ul > li',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "budget-spending",
    routePath: "budget/spending",
    // The other half of BudgetCompositionScreen. Its data-og carries the
    // component's `kind`, which for this ROUTE is `expenditure` — the URL says
    // spending and the prop says expenditure, so the two do not match and the
    // marker follows the prop.
    waitFor: '[data-og="budget-expenditure"] ul > li',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "budget-explorer",
    routePath: "budget/explorer",
    waitFor: '[data-og="budget-explorer"]',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "budget-ministries",
    routePath: "budget/ministries",
    waitFor: 'a[href^="/budget/ministry/"]',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "budget-mod",
    routePath: "budget/mod",
    waitFor: '[data-og="budget-mod"] li',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2000,
  },

  // --- parliament / votes -----------------------------------------------------
  {
    slug: "parliament-similarity",
    routePath: "parliament/similarity",
    // The picker, not a ranking: this page renders nothing until an MP is
    // chosen, and the avatar wall with its party chips is what a reader lands
    // on. Seeding an MP would put a card in front of a subject nobody picked.
    waitFor: 'a[href^="/parliament/similarity/"]',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "parliament-correlation",
    routePath: "parliament/correlation",
    // The signature visual is the party x party cosine MATRIX at the top of the
    // page, which is a plain grid — not Recharts. So anchor on `h1` and let the
    // clip fall over it. Centring on `.recharts-wrapper` instead frames the
    // time-series card 1,000px further down AND, being only 878px wide, shifts
    // the 1200px clip left until the sidebar beside it is sliced mid-word.
    // `.recharts-surface` is still the wait-for: it is drawn after the matrix,
    // so it proves the whole page has its data.
    waitFor: ".recharts-surface",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },

  // --- demographics -----------------------------------------------------------
  {
    slug: "demographics-regions",
    routePath: "demographics/regions",
    waitFor: "table tbody tr",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "demographics-municipalities",
    routePath: "demographics/municipalities",
    waitFor: "table tbody tr",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },

  // --- registers and rankings whose hero is their table ------------------------
  {
    slug: "governance-municipal-finance",
    routePath: "governance/municipal-finance",
    // A choropleth of the 265 municipalities sits above the table — centre on it.
    waitFor: ".leaflet-container",
    anchor: ".leaflet-container",
    centerOnAnchor: true,
    settleMs: 3000,
  },
  {
    slug: "judiciary-magistrates",
    routePath: "judiciary/magistrates",
    waitFor: "table tbody tr",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "water-operators",
    routePath: "water/operators",
    waitFor: "table tbody tr",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "customs-warehouses",
    routePath: "customs/warehouses",
    waitFor: "table tbody tr",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "sverka",
    routePath: "sverka",
    waitFor: "table tbody tr",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "local-chmi",
    routePath: "local/chmi",
    waitFor: "table tbody tr",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },

  // --- the national election tab pages ----------------------------------------
  // All four carry the election in their H1, so the card is dated and has to be
  // re-shot when a new election lands — same as the dashboard card.
  {
    slug: "parties",
    routePath: "parties?elections=2026_04_19",
    waitFor: "table tbody tr",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "regions",
    routePath: "regions?elections=2026_04_19",
    waitFor: "table tbody tr",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "preferences",
    routePath: "preferences?elections=2026_04_19",
    waitFor: "table tbody tr",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "flash-memory",
    routePath: "flash-memory?elections=2026_04_19",
    waitFor: "table tbody tr",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    // The unit-cost methodology page (plan §3). A prose page, so the clip is
    // top-aligned on the H1 like the other document cards rather than centred on
    // a chart — there is no visual here, the title and lede ARE the card.
    slug: "unit-cost-methodology",
    routePath: "governance/sectors/methodology",
    // Wait on the H1 itself: the data-og wrapper is in the first render while
    // the layout's heading arrives a tick later, so waiting on the wrapper let
    // the capture run before the anchor existed.
    waitFor: "h1",
    anchor: "h1",
    settleMs: 2000,
    // ArticleLayout puts its title in an <article><header>, and HIDE_CHROME_CSS's
    // `header, header *` — written for the SITE header — hides it too, which
    // makes the h1 anchor resolve to a HIDDEN element and the shot time out.
    // Re-show the article's own header only. extraCss is appended after
    // HIDE_CHROME_CSS, so this wins.
    extraCss:
      "[data-community-banner]{display:none!important;}" +
      "article header,article header *{display:revert!important;}",
  },
  {
    slug: "recount",
    routePath: "recount?elections=2026_04_19",
    waitFor: "table tbody tr",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
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

const DEFAULT_VIEWPORT = { width: 1280, height: 1100 };

const captureOne = async (page: Page, c: Capture): Promise<void> => {
  // Reset every time rather than only when an override is present, so one entry's
  // viewport cannot leak into the next capture in the loop.
  await page.setViewportSize(c.viewport ?? DEFAULT_VIEWPORT);
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
    viewport: DEFAULT_VIEWPORT,
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
  const failed: string[] = [];
  for (const c of items) {
    try {
      await captureOne(page, c);
    } catch (err) {
      console.error(`failed: ${c.slug}`, err);
      failed.push(c.slug);
      process.exitCode = 1;
    }
  }
  await browser.close();

  // A failed capture leaves the PREVIOUS card on disk, so nothing downstream
  // ever notices: the page keeps serving a share image, and a broken entry is
  // indistinguishable from a working one unless you look at the file's date.
  // indicators-compare sat like that from 23 May — its waitFor matched a
  // zero-radius grid polygon that can never become visible, so every run since
  // timed out into one line of stderr, 90 lines above the prompt. Say it last,
  // and say which.
  console.log(
    `\n${items.length - failed.length}/${items.length} captured` +
      (failed.length
        ? `\n⚠ ${failed.length} FAILED — these still serve their PREVIOUS card:\n  ${failed.join("\n  ")}`
        : ""),
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
