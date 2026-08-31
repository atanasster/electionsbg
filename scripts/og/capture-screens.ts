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
// dev server was auto-assigned a different port.
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
  // CSS selector to wait for before screenshotting. Navigation gets 60 s and
  // THIS SELECTOR 30 s — the 60 belongs to page.goto. Pick something that only
  // appears after the data has loaded, since a selector that resolves early is
  // how a short card overwrites a good one. — pick something that only appears after data has loaded.
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
    slug: "funds",
    routePath: "funds",
    // MOVED HERE from scripts/og/screenshot_funds.ts, which is why this entry exists at all.
    // That script clips {x:0, y:0} and hides no chrome, so the card it produced led with the
    // nav bar, the election picker and the search box, and the page began below them. It had
    // also not been re-shot since 2026-05-27, so it depicted a layout this module no longer
    // has — a centred muted title, a buried StatCard strip and a choropleth — and every
    // figure on it was stale: 52 780 beneficiaries against 53 122, €16.49bn paid against
    // €18.58bn (11% low) and 89 MPs against 148 (40% low).
    //
    // `capture-screens.ts` drops the site chrome and anchors the clip, which is the whole
    // difference. Same shape as its three sibling hubs: anchor the head, wait on the BAND's
    // figures (the head mounts before the payload, so waiting on the container shoots a
    // skeleton), clip at OG_CLIP_VIEWPORT.
    // ⚠ BOTH KPI SOURCES, not just one — and /funds is the only one of the four hubs that
    // needs this. `kpisFor` builds its band from TWO independent queries: `useFundsIndex`
    // feeds cells 1 and 4, `useFundsHubStats` cells 2, 3 and every row of the aside. HubHead
    // renders the real band as soon as EITHER lands, and both hooks document `null` as a
    // legitimate ANSWER rather than an error, so a bare `.tabular-nums` is satisfied by a
    // TWO-cell band — and the runner then overwrites a good card with a half-empty one and
    // reports success. Measured: with `fund-payload?kind=index` nulled the bare selector
    // resolved and a 2-cell card was written; this one times out, the capture fails, and the
    // previous card survives, which is the right failure. The siblings are all-or-nothing
    // from one hook, so they do not need the `:has()`.
    //
    // /funds/political is cell 4's destination (index); /funds/absorption is cell 3's
    // (hubStats). Requiring one from each source is what makes the band provably whole.
    waitFor:
      '[data-hub-head]:has(a[href*="/funds/political"]):has(a[href*="/funds/absorption"]) .tabular-nums',
    anchor: "[data-hub-head]",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
    // ⚠ RE-SHOOT THIS AFTER AN OPEN-CALLS CRAWL. The head is ~495 px and the clip is 630, so
    // ~135 px of whatever follows it is in frame — here the OpenCallsTile, whose first line is
    // a TIMESTAMPED freshness notice. When the crawl is behind, that line turns amber and
    // reads „Последна проверка <time> — списъкът може да не е актуален", and a card shot in
    // that state carries the warning for as long as the card is served. It is true of the live
    // page and false of a permanent artifact, which is the whole failure mode this file keeps
    // finding.
    //
    // Suppressing it was considered and rejected twice over: hiding the notice alone leaves
    // „ОТВОРЕНИ 46" with no freshness qualifier, which is exactly what OpenCallsTile's own
    // invariant 3 forbids; and hiding the tile only pulls the next one into the same 135 px.
    // Something always fills a short anchor's remainder, so the fix is a fresh crawl, not CSS.
  },
  {
    slug: "parliament",
    routePath: "parliament",
    // ANCHOR ON THE HEAD, not the tile grid. §5.3's rule for a hub: the head IS the page's
    // argument now — four labelled corpus figures, each with its basis, over a ranked list of
    // the parliamentary groups. The previous anchor was `[data-og="parliament-hub"]`, the
    // strip-and-grid wrapper, which framed a session strip and three tile fronts and showed
    // no number at all; before that it waited on `div[title*="↔"]`, a heatmap cell the
    // rebuild had already deleted, and would have timed out at 60 s.
    //
    // `waitFor` names the BAND rather than the head, because the head mounts immediately and
    // its figures arrive with the blob — anchoring the wait on the container would shoot a
    // skeleton, which is the failure `waitFor` exists to prevent.
    waitFor: "[data-hub-head] .tabular-nums",
    anchor: "[data-hub-head]",
    // OG_CLIP_VIEWPORT — see the sibling entries: a width below OG_W (1200) makes Playwright
    // clamp the clip and quietly emit a 2360-wide card where the corpus norm is 2400. The
    // head is narrower than the clip either way, so nothing is cut.
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
  },
  {
    slug: "procurement",
    routePath: "procurement?pscope=all",
    // The redesigned hub is a tile grid (no more stat cards). Anchor on the tiles wrapper
    // and top-align. ?pscope=all so the tiles carry the full-corpus figures (the default
    // `ns` scope is only weeks old).
    //
    // Since the hub grew three NAMED bands, the card leads with the first band's heading and
    // its description rather than straight into tiles — checked by eye, and kept: the heading
    // tells a reader what they are looking at, and two full rows of tiles with their headline
    // numbers still fit under it. Re-shoot and LOOK at the PNG if the band structure changes
    // again; a taller description would start pushing the second row out of the crop.
    // ANCHOR ON THE HEAD (§5.3). The tile-grid wrapper framed tile fronts and no figure —
    // a share card for a data module that published no number. `waitFor` names the BAND, not
    // the container: the head mounts immediately and its figures arrive with the blob, so
    // waiting on the wrapper shoots a skeleton.
    waitFor: "[data-hub-head] .tabular-nums",
    anchor: "[data-hub-head]",
    // OG_CLIP_VIEWPORT, the constant that exists for exactly this. A head spans the full
    // content column — identity plus the evidence aside — so at the default 1280 a CENTRED
    // 1200 clip shaves both edges: measured, /governance came back reading „правление" and
    // „29,6 млрд." with the ranked list cut off at „409 8".
    //
    // ⚠ NOT a hand-picked 1180. Playwright CLAMPS the clip to the viewport, so any width
    // below OG_W (1200) silently shrinks the card — measured, 1180 produced 2360×1260 cards
    // against the corpus norm of 2400, and procurement and governance had both been 2400
    // before this entry was touched.
    viewport: OG_CLIP_VIEWPORT,
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
    // ⚠ TWICE MIS-ANCHORED, and both times the card kept being written. First on
    // BudgetFlowTile's `budget-flow`, which LEFT this page when /budget became a tile hub —
    // the capture timed out and the card stayed frozen at 15 May. Then on `h1`, which framed
    // title → intro → the first band of TILES: correct for a tile hub, and wrong the moment
    // the head acquired a KPI band and an evidence aside, since the clip then led with the
    // page's chrome and cut its only figures. §5.3: a hub's card frames its HEAD.
    //
    // ⚠ THE WAIT IS `:has()`-QUALIFIED, like /funds and for a related reason. This head draws
    // from ONE blob, so the band is all-or-nothing — but the ASIDE is not: it renders only
    // when `adminTotalPlannedEur` and `adminUnitCount` are both present, which is exactly the
    // state a database without the gitignored ministry grain produces. A bare `.tabular-nums`
    // is satisfied by the band alone, and the runner would then overwrite a good card with
    // one whose right-hand column is empty and report success. Requiring a `/budget/ministry/`
    // link makes the aside provably present; requiring `/budget/spending` (the band's first
    // cell) makes the band provably rendered rather than skeletal.
    waitFor:
      '[data-hub-head]:has(a[href^="/budget/spending"]):has(a[href^="/budget/ministry/"]) .tabular-nums',
    anchor: "[data-hub-head]",
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
    // ⚠️ RE-ANCHORED ON THE HEAD (§5.3), 2026-08-26. It anchored on the KPI grid, which is
    // the hand-rolled band the head's four cells were promoted OUT of — so the card led with
    // the eight tiles the page deliberately does NOT lead with, and cut the band, the note
    // and the peer rail. The comment also said „12 tiles"; the grid renders eight now.
    //
    // ⚠️ THE WAIT COUNTS THE CELLS, because naming one cannot. A cell is withheld when its
    // series has no point at or before the selected election, and `unemployment` starts
    // 2009-Q1 against 2005-Q1 for the other three — so a short band is a live state, not a
    // hypothetical, and it must not overwrite a good card. The sibling chain asserts LENGTH;
    // `:has(aside a)` additionally requires the peer rail, which is the half most likely to
    // be absent (it renders only when the distribution's period matches the figure's, i.e.
    // on the LATEST election — this card is shot at the default, which is that election).
    //
    // ⚠️ AN ABSENT PAYLOAD IS CAUGHT: the band comes from macro.json and the skeleton cells
    // carry no `data-kpi-cell`, so a 404 times out here and the previous card survives.
    // Figure STALENESS is caught too, but NOT by the freshness clause — that comparison was
    // removed on 2026-08-31 because both payloads are rewritten by the DAILY watcher, so a
    // commit-time comparison reddened this card on every refresh while the PNG was
    // byte-identical. It is now the coverage gate's card-FIGURE clause, which re-derives
    // this band and this rail from the two payloads and compares what the card SHOWS. That
    // clause is what caught the rail moving „Растеж 7 от 22" -> „8 от 24". §10's „look at
    // the png" is still the only thing that can judge the picture.
    //
    // ⚠️ THIS CLAUSE HAS AN EXPIRY, and it is worth knowing before it fires. The rail's real
    // precondition is not „the latest election" but „`latestDistribution.period` still equals
    // the band's clamped period", and the two advance on different clocks: `asOf` is pinned
    // by the election while the distribution follows Eurostat. gdpGrowth and inflation
    // already sit exactly on that boundary, so the FIRST refresh past 2026-Q2 drops every
    // rail row and this selector stops resolving on a page that is perfectly fine. The
    // failure is fail-safe — the previous card survives and the runner names it on stderr —
    // and the fix then is to drop `:has(aside a)`, not to weaken the cell chain.
    waitFor:
      "[data-hub-head]:has(aside a) [data-kpi-cell] ~ [data-kpi-cell] ~ [data-kpi-cell] ~ [data-kpi-cell]",
    anchor: "[data-hub-head]",
    viewport: OG_CLIP_VIEWPORT,
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
    // No `?elections=` — the head reads only the prices blob, and the frame no longer
    // contains anything the election context feeds.
    routePath: "consumption",
    // ⚠️ RE-ANCHORED ON THE HEAD (§5.3). It framed `[data-og="consumption-hub"]` — the
    // tile grid — which was right while the hub was a launcher and wrong the moment it
    // acquired a KPI band and an evidence aside: the card led with coloured tiles and cut
    // every figure on the page.
    //
    // ⚠️ THE WAIT NAMES EVERY CELL, not just two. This head draws from ONE blob, but its
    // four cells are guarded on four INDEPENDENT field groups fed by four different
    // upstreams in `build_payloads.ts` — the КЗП index, macro.json's Eurostat CPI, the PPP
    // block folded out of macro_peers.json, and the product count — and each is withheld
    // rather than captioned vaguely when its window is missing. So a blob short of any one
    // arm still renders a band, and a guard naming two cells is satisfied by it: the runner
    // then overwrites a good card with a three-cell one and reports success. Measured on a
    // cloned head with the non-basket cells removed, the two-arm form still resolved.
    //
    // One arm per destination, plus a chain row for the aside — which is refused outright
    // when its denominators are missing, so it needs its own proof of presence.
    waitFor:
      '[data-hub-head]:has(a[href^="/prices"]):has(a[href^="/consumption/overview"])' +
      ':has(a[href^="/consumption/eu"]):has(a[href^="/consumption/products"])' +
      ':has(a[href^="/consumption/chain/"]) .tabular-nums',
    anchor: "[data-hub-head]",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    // ⚠️ THREE CARDS THAT ONLY EXIST BECAUSE /consumption's WAS RE-ANCHORED. All six
    // consumption launcher pages shared `/og/consumption.png`, which used to be the hub's
    // TILE GRID — topic-neutral, so sharing it everywhere cost nothing. It is now the
    // hub's own argument (a price band and a cheapest-basket ranking), which improved
    // /consumption/chains and /consumption/products (the card names both) and left these
    // three advertising a picture about neither. That is the exact defect the
    // `budget-deep-dive` entry above was created to fix; leaving it would have been the
    // same mistake with the blame moved.
    slug: "consumption-categories",
    routePath: "consumption/categories",
    // Anchor on the section so the clip leads with the title and the ranked list — the
    // page IS the list. The wait is a ROW LINK rather than the section: the section
    // renders before its data lands, so waiting on it shoots an empty card.
    waitFor: 'a[href^="/consumption/category/"]',
    anchor: 'section[aria-label="Категории"]',
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2000,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "consumption-deals",
    routePath: "consumption/deals",
    // ⚠️ THE ONE CARD ON THIS PAGE THAT GOES STALE BY DESIGN. Its subtitle is „…днес" over
    // a dated promo set, so a card shot today asserts today's cuts for as long as it is
    // served. That is inherent to a deals page rather than fixable by CSS — re-shoot it
    // whenever the picture matters, and prefer never quoting its figures elsewhere.
    // A CHAIN link inside the section — the deal rows name the shop, and this page has no
    // per-product route. Waiting on the section alone shoots an empty card: it renders
    // before its data lands.
    waitFor: 'section[aria-label="Промоции"] a[href^="/consumption/chain/"]',
    anchor: 'section[aria-label="Промоции"]',
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "consumption-unit-prices",
    routePath: "consumption/unit-prices",
    // No `aria-label`ed section and no per-product route on this page, so the wait is a
    // priced cell INSIDE `main` — `.tabular-nums` alone is satisfied by the site header's
    // election dates, which render before any of this page's data.
    waitFor: "main .tabular-nums",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
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
    slug: "abroad",
    routePath: "declarations/abroad",
    // The held-abroad register, largest holding first. No ?elections= for the same reason
    // as crypto above: the rows are declarants across every tier, keyed on the filing year.
    //
    // ⚠️ RE-SHOOTING THIS NEEDS THE RESOURCE SERVED, NOT JUST THE DATA. It shoots the dev
    // server, whose /api/db proxies to the deployed `db` function — so migration 169 being
    // on Cloud SQL is necessary and NOT sufficient: until `deploy:db` ships the
    // abroad_holdings resource, prod answers „unknown resource" and the shot is an empty
    // table. Point VITE_DB_API_PROXY at a local functions emulator (local code, Cloud SQL
    // data) to capture before that deploy.
    waitFor: '[data-og="abroad-registry-og"] tbody tr',
    anchor: '[data-og="abroad-registry-og"]',
    leftAlign: true,
    settleMs: 2500,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "official-companies",
    // Retired /governance/companies redirects here — same share-card identity (slug), wider
    // scope (188): ?political=1 reproduces the old officials-linked population.
    routePath: "companies?political=1&elections=2026_04_19",
    // MP-connected companies (most MPs first) — company rows with their linked-MP
    // avatars. (Was a rendered text card — job removed from generate.ts.)
    // ⚠️ `tr.group`, NOT a bare `tbody tr`. DbDataTable puts a TableRow in its LOADING,
    // ERROR and EMPTY branches too, so the loose selector resolves on first paint — and
    // since this resource is not on prod yet while the capture proxies /api/db there, it
    // would shoot a card whose entire content is „Could not load data." and exit 0. The
    // same reasoning is spelled out at the subsidies and administration captures above.
    waitFor: '[data-og="official-companies-og"] tbody tr.group',
    anchor: '[data-og="official-companies-og"]',
    leftAlign: true,
    settleMs: 2500,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  // ── the four /culture/funds source pages ─────────────────────────────────
  //
  // Each shoots its OWN chart. The sibling culture sub-pages share
  // /og/culture.png with a comment saying to give them their own „once a capture
  // entry and a `data-og` anchor land together" — which is what these are: the
  // bar list is distinctive per arm and self-explanatory in a preview (a
  // heading, a declared axis, named bars).
  //
  // ⚠️ WAIT ON A BAR, NOT ON THE SECTION. The section renders as soon as the
  // page does; its rows arrive with `fund_sources.json`, a SEPARATE fetch from
  // the hub blob. Anchoring on the container alone would shoot an empty frame
  // and exit 0 — the same trap the officials-companies capture above documents
  // for DbDataTable's loading branch.
  //
  // ⚠️ `viewport: OG_CLIP_VIEWPORT`, NOT `leftAlign`. These shipped leftAlign at
  // the shared 1280 first, and the 1200 clip sliced the section's right edge:
  // culture-funds-dfz rendered „това е предимно исто" — „рия, а" gone, the
  // sentence destroyed — culture-funds-interreg lost „ава" from „получава", and
  // all four dropped the per-row count noun, leaving bare integers whose unit
  // differs per arm. The section is full-width, so the fix is the reports
  // family's: narrow the VIEWPORT so the layout fits the clip, rather than
  // cropping a layout that does not. Nothing caught it — the viewport, dimension
  // and freshness clauses of the card gate all iterate HUB_CAPTURES only.
  {
    slug: "culture-funds-isun-eik",
    routePath: "culture/funds/isun-eik",
    waitFor: '[data-og="culture-funds-breakdown"] li',
    anchor: '[data-og="culture-funds-breakdown"]',
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2000,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "culture-funds-isun-name",
    routePath: "culture/funds/isun-name",
    waitFor: '[data-og="culture-funds-breakdown"] li',
    anchor: '[data-og="culture-funds-breakdown"]',
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2000,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "culture-funds-interreg",
    routePath: "culture/funds/interreg",
    waitFor: '[data-og="culture-funds-breakdown"] li',
    anchor: '[data-og="culture-funds-breakdown"]',
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2000,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "culture-funds-dfz",
    routePath: "culture/funds/dfz",
    waitFor: '[data-og="culture-funds-breakdown"] li',
    anchor: '[data-og="culture-funds-breakdown"]',
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2000,
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
    slug: "culture-hub",
    routePath: "culture",
    // The sector hub's OWN card, minted 2026-08-26 when /culture grew a head. Until then
    // it shared `/og/culture.png` with five sibling pages, and that image is shot from
    // /culture/subsidies — so the hub's card depicted the film dashboard, which is 13% of
    // the money the hub exists to put in proportion.
    //
    // ⚠️ THE WAIT NAMES THE TWO OPTIONAL CELLS BY THEIR OWN DESTINATIONS, and nothing else
    // works. Two of the four cells come from fields that are OPTIONAL on the wire (`budget`
    // and `films` ship via bucket:sync, a different command from `npm run deploy`), so a
    // short band is a live state — and it is exactly the state that must not overwrite a
    // good card.
    //
    // A bare `[data-kpi-cell]` is satisfied by a two-cell band. So was this selector's first
    // cut, which asked for a `/culture/procurement` link and an `/awarder/` link: BOTH are
    // satisfied by the evidence aside alone, because the rail's action link is
    // `/culture/procurement?pscope=all` and `HubHead` renders it inside the same `<aside>`
    // as the rows. It named the one cell that is pushed unconditionally and neither of the
    // two that can vanish — verbatim the failure the paragraph claimed to prevent.
    //
    // `data-kpi-cell` sits on the `<Link>` itself (see `KpiCell`), so the two optional cells
    // can be required directly. `/culture/subsidies` is the films cell and `/budget/…` the
    // budget cell; the trailing `[data-kpi-cell]` keeps the wait on a cell rather than on
    // the head, so a head that paints with no band at all still times out.
    //
    // ⚠️ THE ASIDE IS DELIBERATELY NOT REQUIRED HERE. It refuses when `topBuyers` is absent,
    // which is the same bucket-sync lag — but a card showing a full band and no rail is a
    // worse card, not a wrong one, and requiring it would block a re-shoot on the very
    // vintage where the band is what changed.
    //
    // ⚠️ AN ABSENT BLOB IS CAUGHT HERE, unlike on /subsidies — and this paragraph said the
    // opposite, inherited verbatim from an entry whose head can genuinely paint figureless
    // from a second source. A 404 IS an answer (`useCultureHubStats` → null), but this
    // head's band AND aside both come from that one blob, so it renders neither, the
    // selector matches nothing, the capture times out and the previous card survives. What
    // NO selector can see is figure STALENESS: every cell is drawn from a blob `bucket:sync`
    // ships, so a corpus reload moves each number and touches no tracked file. That is what
    // §10's „look at the png" is for.
    waitFor:
      '[data-hub-head]:has([data-kpi-cell][href^="/budget/ministries"]):has([data-kpi-cell][href^="/culture/subsidies"]) [data-kpi-cell]',
    anchor: "[data-hub-head]",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "culture",
    // /culture/subsidies, NOT /culture: the film dashboard this shot frames moved
    // there when /culture became the sector hub (2026-08-18), and
    // `data-og="culture-hero"` moved with it. Left pointing at /culture, the
    // capture waits 30 s for a selector that page no longer has, throws, and
    // takes the whole run's exit code with it — while /og/culture.png keeps
    // depicting the moved dashboard.
    //
    // The SLUG stays `culture` on purpose: /culture/subsidies and /culture/films
    // declare `ogImage: "/og/culture.png"`, so renaming the file would blank the
    // card on both. This comment said „both the hub and the subsidies page" until
    // 2026-08-26 and was wrong in both directions — the file was then referenced by
    // SIX routes, not two, and the hub was about to leave. Everything the film card
    // did not depict moved to `culture-hub` above; what is left are the two pages it
    // depicts EXACTLY, which is the right population for it.
    routePath: "culture/subsidies",
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
    // ⚠️ RE-ANCHORED ON THE HEAD (§5.3), and this is the THIRD anchor this entry has had.
    // It was `[data-og="subsidies-hero"]` (a KPI strip that was deleted), then
    // `[data-og="subsidies-hub"]` (the tile grid), and the grid was right for a tile hub and
    // wrong the moment the page grew a band and an evidence aside: the card led with tile
    // fronts and cut every figure. The `main{max-width:1216px}` cap went with it — it existed
    // to make the FOUR-column tile grid fit the 1200 crop, and the head is a two-column
    // layout that needs no such help.
    //
    // ⚠️ THE WAIT NAMES A CELL AND A ROW, not `.tabular-nums`. Both halves of this head can
    // legitimately be absent: the band is withheld cell-by-cell when the blob lacks a window,
    // and the aside is refused outright when it cannot state the untraceable share. A bare
    // numeric selector is satisfied by a partial band, and the runner would then overwrite a
    // good card with a short one and report success. `/subsidies/browse` is the paid cell's
    // destination and `/farm/` a recipient row, so requiring both makes each half provably
    // present.
    //
    // ⚠️ AND THE FIGURES CAN BE ABSENT WITHOUT THE PAGE FAILING — see `hubFailed` on the
    // screen: with /api/db/agri-hub-stats down the tiles render with no numbers at all. That
    // is what §10's „look at the png" is for; no selector catches it.
    waitFor:
      '[data-hub-head]:has(a[href^="/subsidies/browse"]):has(a[href^="/farm/"]) [data-kpi-cell]',
    anchor: "[data-hub-head]",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
    extraCss: "[data-community-banner]{display:none!important;}",
  },
  {
    slug: "governance",
    routePath: "governance",
    // /governance is now the Управление tile-hub — lead the card with the first
    // cluster of sub-hub tiles (like the sectors hub), not the old dashboard.
    // ANCHOR ON THE HEAD (§5.3). The tile-grid wrapper framed tile fronts and no figure —
    // a share card for a data module that published no number. `waitFor` names the BAND, not
    // the container: the head mounts immediately and its figures arrive with the blob, so
    // waiting on the wrapper shoots a skeleton.
    waitFor: "[data-hub-head] .tabular-nums",
    anchor: "[data-hub-head]",
    // OG_CLIP_VIEWPORT, the constant that exists for exactly this. A head spans the full
    // content column — identity plus the evidence aside — so at the default 1280 a CENTRED
    // 1200 clip shaves both edges: measured, /governance came back reading „правление" and
    // „29,6 млрд." with the ranked list cut off at „409 8".
    //
    // ⚠ NOT a hand-picked 1180. Playwright CLAMPS the clip to the viewport, so any width
    // below OG_W (1200) silently shrinks the card — measured, 1180 produced 2360×1260 cards
    // against the corpus norm of 2400, and procurement and governance had both been 2400
    // before this entry was touched.
    viewport: OG_CLIP_VIEWPORT,
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
    // ⚠️ RE-ANCHORED ON THE HEAD (§5.3). It was `[data-og="declarations-hub"]`, the tile
    // grid — right for a tile hub, and wrong the moment the page grew a band: the card led
    // with tile fronts and cut every figure. Same move `subsidies` made above, for the same
    // reason.
    //
    // ⚠️ THE WAIT NAMES A SCOPED CELL, not `[data-kpi-cell]` alone. Three of the four cells
    // are corpus-wide and render from the blob's top level, while the MP cell needs the
    // selected parliament's SLICE — so a blob whose `byNs` is missing that parliament still
    // satisfies a bare cell selector with a three-cell band, and the runner would overwrite
    // a good card with a short one and report success. `/mp-assets` is that cell's
    // destination, so requiring it makes the scoped half provably present.
    //
    // ⚠️ AND THE FIGURES CAN BE ABSENT WITHOUT THE PAGE FAILING — a 404 on the stats blob is
    // an ANSWER here (the hook renders the tiles bare), so the head paints with no band at
    // all and no selector below catches it. That is what §10's „look at the png" is for.
    waitFor: '[data-hub-head]:has(a[href^="/mp-assets"]) [data-kpi-cell]',
    anchor: "[data-hub-head]",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "reports-hub",
    routePath: "parliamentary/reports",
    // ⚠️ RE-ANCHORED ON THE HEAD (§5.3), 2026-08-27 — the `governance-sectors` /
    // `indicators` move, for the third and fourth time. It anchored on the tile grid, which
    // was right for a tile hub and wrong the moment the page grew a head. Worse here than
    // on those two: the head PROMOTED both tiles' figures, so the old card led with tiles
    // that no longer carry a number at all.
    //
    // ⚠️ TWO CELLS, NOT FOUR, and the wait says so. This hub's registry carries a `statId`
    // for `risk` and `turnout` only, so a four-cell chain would never resolve and every
    // capture would time out on a page that is rendering correctly.
    waitFor: "[data-hub-head]:has(aside a) [data-kpi-cell] ~ [data-kpi-cell]",
    anchor: "[data-hub-head]",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
  },
  {
    slug: "analysis-hub",
    routePath: "parliamentary/analysis",
    // ⚠️ RE-ANCHORED ON THE HEAD (§5.3), 2026-08-27 — see `reports-hub` above. The old
    // comment described the card as leading with „their headline numbers"; those numbers are
    // now in the band, and the four tiles behind them render bare.
    //
    // ⚠️ THE WAIT COUNTS THE CELLS, because naming them cannot. A cell is withheld when the
    // selected election's payload lacks that stat — `2005_06_25` carries no `persistence`,
    // so that cycle is three — and this card must not be overwritten by a short one and
    // reported as success. The capture runs on the default (latest) election, which carries
    // all four.
    //
    // ⚠️ `:has(aside a)` IS NOT REDUNDANT WITH THE CELL CHAIN HERE, unlike on
    // /governance/sectors where the two clauses were logically equivalent. The rail comes
    // from a SECOND fetch (risk_score_summary.json) with no ordering guarantee against the
    // band's, so a head can genuinely have four cells and no aside for a frame — which is
    // the state that would be captured.
    waitFor:
      "[data-hub-head]:has(aside a) [data-kpi-cell] ~ [data-kpi-cell] ~ [data-kpi-cell] ~ [data-kpi-cell]",
    anchor: "[data-hub-head]",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 3000,
  },
  {
    slug: "governance-sectors",
    routePath: "governance/sectors?pscope=all",
    // ⚠️ RE-ANCHORED ON THE HEAD (§5.3), 2026-08-26. It anchored on the tile grid — right
    // for a tile hub, and wrong the moment the page grew a head: the card led with tile
    // fronts and cut the band and the aside, which is where this page's actual argument is.
    // `?pscope=all` stays, for the full-corpus figures on the tender-driven sectors.
    //
    // The comment said „the 15-sector tile hub" and „matura score"; the hub carries
    // NINETEEN sectors and the `score` basis was retired in 2026-08 (useSectorStats' header
    // records it).
    //
    // ⚠️ THE WAIT COUNTS THE CELLS, because naming them cannot. A band cell is withheld
    // whenever its basis has no publishable sector — measured over the committed payload,
    // the band is short on 12 of 30 scope keys, distribution {1:4, 2:4, 3:4, 4:18} — and
    // this card must not be overwritten by a short one and reported as success.
    //
    // The first cut asked for a `/procurement` cell AND an `/sector/` aside row. Both
    // clauses are LOGICALLY EQUIVALENT here: `sectorsHubEvidence` filters on exactly the
    // predicate that produces the procurement cell, so aside-present ⟺ procurement-cell-
    // present. It refused 1 of the 30 keys, and that one was the LEAST short at three cells,
    // while all four one-cell bands sailed through — each of them being the procurement cell
    // with a full four-row aside. The sibling chain below asserts LENGTH, which is the thing
    // that was actually meant.
    //
    // `:has(aside a)` rather than a path prefix: the rail's rows link to each sector's own
    // page and one of them is `/water`, not `/sector/water`, so a prefix would refuse a
    // perfectly good head on any scope where water were the only publishable roster.
    //
    // ⚠️ AN ABSENT PAYLOAD IS CAUGHT: band and aside both come from the one artifact, so a
    // 404 renders neither, this times out and the previous card survives. Figure STALENESS
    // is caught too on this hub — unlike the `/api/db` heads, its payload
    // (data/procurement/derived/sector_stats.json) is GIT-TRACKED, so the coverage gate's
    // freshness clause compares the card against it. §10's „look at the png" is still the
    // only thing that can judge the picture.
    waitFor:
      "[data-hub-head]:has(aside a) [data-kpi-cell] ~ [data-kpi-cell] ~ [data-kpi-cell] ~ [data-kpi-cell]",
    anchor: "[data-hub-head]",
    viewport: OG_CLIP_VIEWPORT,
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

  {
    // MOVED HERE from scripts/og/screenshot_procurement.ts, now deleted — the last family
    // script that still wrote cards this way. It clipped {x:0, y:0} and hid no chrome, so the
    // card led with the nav bar, the election picker and the search box, and the page began
    // below them; it had not been re-shot since 2026-05-27, so it also carried the pre-rework
    // centred, muted title.
    //
    // A sub-page, so `anchor: "h1"` rather than `[data-hub-head]` — HIDE_CHROME_CSS drops the
    // site header, which makes the h1 the top of the page and the clip read title → scope →
    // intro → the four figures → the three oblast choropleths. NOT the ranked table, which
    // sits below the clip — an earlier draft of this comment claimed otherwise.
    //
    // ⚠ `waitFor` NAMES THE GEO PAYLOAD, and getting this wrong twice is what the attribute
    // exists for. `"h1, table"` was satisfied by the `h1` alone — `<Title>` renders in the
    // error branch too — so a failed call produced a card of an empty page. A settlement ROW
    // LINK fixed that and was still wrong: the rows come from the TABLE's request, while both
    // the four figures and the three choropleths come from `useProcurementGeo`. With the row
    // link, a failed /api/db/procurement-geo left „—" in every KPI and three grey maps while
    // the table loaded and the capture reported success.
    //
    // `[data-og="procurement-geo-loaded"]` is set on the KPI strip only when `summary` is
    // present, so it means „the payload this card is a picture of has arrived".
    //
    // `?pscope=all`, like the /procurement hub entry beside it. Without it the page opens on
    // the SELECTED parliament and the card reads „332 населени места · €2,42 млрд." — one
    // term's slice, served as the family image for all 870 settlement pages, of which 538
    // have no contracts in that window at all. At `all` it reads „870 населени места ·
    // €49,42 млрд.", and that 870 is exactly the number of pages this card serves.
    // (The pre-2026-08 card showed 388 / €36,07 млрд.; both the corpus and the placement
    // rules have moved since, which is the sort of drift the freshness gate now catches.)
    slug: "procurement-by-settlement",
    routePath: "procurement/by-settlement?pscope=all",
    waitFor: '[data-og="procurement-geo-loaded"]',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },

  // --- /funds sub-pages -------------------------------------------------------
  // MOVED HERE from scripts/og/screenshot_funds.ts, which is now deleted. That script clipped
  // {x:0, y:0} and hid no chrome, so all four cards led with the nav bar, the election picker
  // and the search box — roughly a tenth of the frame — and the page began below them. None
  // had been re-shot since 2026-05-27, so each also carried the pre-rework centred, muted
  // title this site no longer uses.
  //
  // These are SUB-PAGES, not hubs, so `[data-hub-head]` does not exist on them. `anchor: "h1"`
  // is the recipe for exactly this shape: HIDE_CHROME_CSS drops the site header, so the h1 IS
  // the top of the page and the clip reads title → intro → the first figures. It pairs with
  // OG_CLIP_VIEWPORT and never with leftAlign, which would pin the clip to the h1's own left
  // edge rather than the content column's.
  //
  // ⚠ `waitFor` IS A ROW LINK, NOT THE `h1`, ON THE FIRST THREE. All three screens render
  // `<Title>` in their ERROR branch as well as their loaded one, so an `h1` wait cannot tell
  // the two apart — and `networkidle` does not close the gap either: it covers the skeleton
  // race (a 20 s artificial delay still produced a correct card) but a FAILED request settles
  // the network immediately. Reproduced by aborting /api/db/fund-payload and replaying the
  // capture: it wrote a funds-political card whose entire body reads „няма сигнализирани
  // бенефициенти", against a true 279 beneficiaries and €7.46bn — a false claim about named
  // politicians, published as the module's share image. funds-integrity and funds-rrf came
  // back carrying the untranslated „Run the funds:ingest-projects pipeline".
  //
  // A `/company/` row link exists only in the success branch (50 / 20 / 10 rows measured), so
  // it fails loudly and the previous card survives, which is the right failure.
  //
  // `settleMs: 2500` is the family's number rather than a measured one — these four carry no
  // charts and settle ~1 s after networkidle — kept for consistency, and harmless.
  {
    slug: "funds-political",
    routePath: "funds/political",
    waitFor: 'a[href^="/company/"]',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "funds-integrity",
    routePath: "funds/integrity",
    waitFor: 'a[href^="/company/"]',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    slug: "funds-rrf",
    routePath: "funds/rrf",
    waitFor: 'a[href^="/company/"]',
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  {
    // A dossier page, so the card is one worked example rather than the module — the same
    // `/funds/focus/<slug>` card every child of that family points at.
    //
    // ⚠ `h1` IS SAFE HERE ONLY BY ACCIDENT, which is worth writing down because the accident
    // is one edit from ending. Unlike its three siblings this screen renders NO `<Title>`
    // while loading or when empty, so an `h1` wait already means „loaded". Add a heading to
    // the empty state — a natural, obviously-good change — and this entry starts shooting it.
    slug: "funds-focus",
    routePath: "funds/focus/guest-houses",
    waitFor: "h1",
    anchor: "h1",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
  // (the /funds HUB card itself is the `funds` entry near the top of this table, beside its
  //  three sibling hubs — they share a framing rule, which is a stronger grouping than the
  //  module clustering this block follows.)
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
    // NOT `funds-focus` — that slug is the per-THEME card, shot off
    // /funds/focus/guest-houses a few entries above, which every /funds/focus/<slug>
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
    // at a file that had never been written: the old scripts/og/screenshot_funds.ts
    // carried the spec and nobody had run it, so both language variants shipped an
    // og:image that 404s. That script is now deleted — it clipped {x:0,y:0} with the
    // site header still in the DOM, so every card it made was chrome down to the fold.
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
  // ⚠️ WITH ONE EXCEPTION, AND IT IS THE FIRST ENTRY. `governance-mayor-pay` was moved onto
  // its HEAD on 2026-08-31, so its hero is no longer its table — it is left here rather than
  // relocated to the head-anchored cluster ~400 lines above because the block is otherwise
  // ordered by PAGE FAMILY, and splitting the governance rankings across two sections to
  // follow an anchor is the smaller of the two prices. Read the divider as "where the
  // governance registers live", and each entry's own anchor as the truth.
  {
    slug: "governance-mayor-pay",
    routePath: "governance/mayor-pay",
    // ⚠️ RE-ANCHORED ON THE HEAD (§5.3), 2026-08-31 — the `governance-sectors` / `indicators`
    // move, with ONE DIFFERENCE THAT MATTERS FOR ANYONE DEBUGGING A SIMILAR CARD. Those two
    // anchored on a tile grid and genuinely cut the band out of the crop. This one anchored
    // on `h1`, which sits ~24px inside the head, so the band would have been inside the crop
    // already: measured off the new card, the h1 top is ~30 CSS px in and the band's bottom
    // ~336, against a 630 px crop.
    //
    // So the anchor was NOT what was wrong here — the CARD was. It was shot on 2026-08-25
    // (8d378e10b0) from a page that had no `HubHead` at all; the screen adopted one on
    // 2026-08-28 (fc4fb81bf8) and dropped the top-20 bar chart the card led with. There were
    // no four figures to crop out, because there were no four figures. The RE-SHOOT is what
    // put them on the card; the re-anchor adds the eyebrow and the freshness line („най-нова
    // декларация: 2026") and is what the coverage gate's head clauses require.
    //
    // ⚠️ THE WAIT COUNTS FOUR CELLS, and here that is EXACT rather than a floor: the band is
    // all-or-nothing (`mayorPayHubKpis` returns 4 cells or none), so it renders 4 or 0.
    //
    // ⚠️ THE `table tbody tr` WAIT IT REPLACES WAS NOT WEAKER — do not read it that way. The
    // table renders off the same `rows` in the same React commit and the capture applies no
    // filters, so its presence IMPLIED the band. It was simply a claim about a part of the
    // page this card no longer leads with. What makes the cell chain a real data gate is
    // that `KpiCellSkeleton` carries no `data-kpi-cell` (see HubHead.tsx), so the head div
    // can paint with the band still pending and the chain will not resolve on it.
    //
    // No `:has(aside a)` arm, unlike its siblings: this head carries no evidence rail, so
    // requiring one would time out on a page that is rendering correctly.
    waitFor:
      "[data-hub-head] [data-kpi-cell] ~ [data-kpi-cell] ~ [data-kpi-cell] ~ [data-kpi-cell]",
    anchor: "[data-hub-head]",
    viewport: OG_CLIP_VIEWPORT,
    settleMs: 2500,
  },
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
