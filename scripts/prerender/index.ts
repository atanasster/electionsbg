import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  DEFAULT_OG_IMAGE,
  PrerenderRoute,
  SITE_URL,
  prerenderRoutes,
} from "./routes";
import { buildDynamicRoutes } from "./dynamicRoutes";
import { buildSiteNav } from "./bodyBuilders";
import {
  RenderVariant,
  encodeUrlPath,
  renderSeoBlock,
  resolveOgImage,
} from "./seoBlock";
import { loadEnv } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DIST = path.join(PROJECT_ROOT, "dist");
const PUBLIC_ASSETS = path.join(PROJECT_ROOT, "public");

const SEO_BLOCK_RE = /<!-- SEO -->([\s\S]*?)<!-- \/SEO -->/;
const BODY_BLOCK_RE = /<!-- BODY -->([\s\S]*?)<!-- \/BODY -->/;

// `vite build` runs in mode "production" unless --mode is passed, and nothing
// in package.json passes one. NODE_ENV is NOT that mode — Vite sets NODE_ENV
// *from* the mode, so reading it back would be a second, independent input that
// can silently disagree with the bundle's own env resolution. Any shell that
// exports NODE_ENV would then make this read a different .env file than the
// bundle did, yielding DATA_BASE="" and a same-origin href that hosting answers
// with the SPA shell at 200.
const BUILD_MODE = "production";

// Origin the runtime data fetches resolve to, read through Vite's OWN env
// loader. That is not ceremony: a preload href must match the eventual fetch
// URL byte-for-byte or the browser downloads the file TWICE, so re-deriving the
// base by hand-parsing .env.production would be a second source of truth for
// the one string that must not drift.
const DATA_BASE =
  loadEnv(BUILD_MODE, PROJECT_ROOT, "VITE_").VITE_DATA_BASE_URL ?? "";

// Belt-and-braces on the above: the base Vite inlined into the entry chunk is
// the only origin the app will actually request, so compare against it rather
// than trusting that two env resolutions agreed. Closes the whole class — a
// stale or missing .env.production (it is gitignored, so a clean clone has
// none) fails the build instead of shipping ~248k pages of dead hints.
const assertBaseMatchesBundle = (routes: PrerenderRoute[]) => {
  if (!DATA_BASE || !routes.some((r) => r.preloadData?.length)) return;
  const assetsDir = path.join(DIST, "assets");
  if (!fs.existsSync(assetsDir)) return;
  const entry = fs.readdirSync(assetsDir).find((f) => /^index-.*\.js$/.test(f));
  if (!entry) return;
  const js = fs.readFileSync(path.join(assetsDir, entry), "utf-8");
  if (!js.includes(DATA_BASE)) {
    throw new Error(
      `preload base ${DATA_BASE} is absent from the built bundle (${entry}) — ` +
        `the prerender and \`vite build\` resolved different env modes. Every ` +
        `preload href would miss the fetch it is meant to warm.`,
    );
  }
};

// Does dist/ hold the card a route declares? By the time this step runs both
// producers have written: `vite build` copied public/og, and
// scripts/og/generate.ts rendered the data-driven families into dist/og
// immediately before. A miss is therefore a card that was never built — see
// resolveOgImage in seoBlock.ts for why that is routine on a data-less
// checkout and a real gap on a deploy build.
//
// Memoized because ~250k route variants draw on a few hundred distinct cards.
const cardCache = new Map<string, boolean>();
const cardExists = (rel: string): boolean => {
  let hit = cardCache.get(rel);
  if (hit === undefined) {
    hit = fs.existsSync(path.join(DIST, rel));
    cardCache.set(rel, hit);
  }
  return hit;
};

// The swap must not be silent. On a checkout without data/<election>/ it is
// expected and says so; on a deploy build it is the one signal that a card
// which SHOULD exist does not — and every other symptom of that is invisible
// (the page still renders, and the head still carries a valid image URL).
//
// Counted in a second pass over the same memoized probe rather than inside
// renderSeoBlock, so the number is per ROUTE and cannot be inflated by
// resolveOgImage probing a path twice.
const reportOgFallbacks = (routes: PrerenderRoute[]) => {
  const fallen = new Map<string, number>();
  for (const r of routes) {
    if (!r.ogImage) continue;
    if (resolveOgImage(r.ogImage, cardExists) !== DEFAULT_OG_IMAGE) continue;
    const variants = r.english ? 2 : 1;
    fallen.set(r.ogImage, (fallen.get(r.ogImage) ?? 0) + variants);
  }
  if (!fallen.size) return;
  const variants = [...fallen.values()].reduce((a, b) => a + b, 0);
  const worst = [...fallen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rel, n]) => `      ${rel} × ${n}`)
    .join("\n");
  console.warn(
    `prerender: ${fallen.size} declared og:image card(s) are not in dist/ — ` +
      `${variants} page variant(s) fell back to the site-wide card.\n` +
      `    Expected on a checkout without data/<election>/: the rendered ` +
      `og/region, og/party, og/local and og/cabinet families are built from it ` +
      `and it is gitignored. On a DEPLOY build a card is genuinely missing — ` +
      `re-run \`npm run og\`.\n${worst}`,
  );
};

const renderBodyBlock = (variant: RenderVariant): string => {
  // Per-page body (may be empty for thin routes) followed by the shared
  // section navigation, so every prerendered page carries a crawlable
  // internal link to each data hub. See bodyBuilders.buildSiteNav.
  const inner =
    (variant.bodyHtml ?? "") + buildSiteNav(variant.lang, PUBLIC_ASSETS);
  return `<!-- BODY -->\n    <div id="ssg-content" hidden>${inner}</div>\n    <!-- /BODY -->`;
};

const writeVariant = (
  template: string,
  route: PrerenderRoute,
  variant: RenderVariant,
  outRelative: string,
) => {
  if (!SEO_BLOCK_RE.test(template)) {
    throw new Error(
      "dist/index.html is missing the <!-- SEO --> ... <!-- /SEO --> block.",
    );
  }
  if (!BODY_BLOCK_RE.test(template)) {
    throw new Error(
      "dist/index.html is missing the <!-- BODY --> ... <!-- /BODY --> block.",
    );
  }
  let html = template.replace(
    SEO_BLOCK_RE,
    renderSeoBlock(route, variant, DATA_BASE, cardExists),
  );
  html = html.replace(BODY_BLOCK_RE, renderBodyBlock(variant));
  // Swap the document language attribute when emitting an English variant.
  if (variant.lang === "en") {
    html = html.replace(/<html\s+lang="[^"]*"/, '<html lang="en"');
  }
  const outPath = path.join(DIST, outRelative);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf-8");
};

const bgUrlFor = (route: PrerenderRoute): string =>
  route.path === ""
    ? `${SITE_URL}/`
    : `${SITE_URL}/${encodeUrlPath(route.path)}`;

// No trailing slash — hosting runs `trailingSlash: false`, so `/en/` 301s to
// `/en`. The bare root is the one exception: `/` is never stripped, so bgUrlFor
// keeps its slash while the EN root must drop it. Emitting `/en/` here would
// give the EN homepage the exact redirecting-canonical defect that setting
// removes everywhere else. See firebase.json (hosting.main.trailingSlash).
const enUrlFor = (route: PrerenderRoute): string =>
  route.path === ""
    ? `${SITE_URL}/en`
    : `${SITE_URL}/en/${encodeUrlPath(route.path)}`;

const writeRoute = (template: string, route: PrerenderRoute) => {
  const bgUrl = bgUrlFor(route);
  const enUrl = route.english ? enUrlFor(route) : undefined;
  // BG (default) variant.
  writeVariant(
    template,
    route,
    {
      lang: "bg",
      title: route.title,
      description: route.description,
      bodyHtml: route.bodyHtml,
      jsonLd: route.jsonLd,
      selfUrl: bgUrl,
      // An English mirror that canonicalises back here is not an alternate —
      // it is a duplicate we keep navigable. Advertising hreflang="en" at a
      // page that points its canonical at this one is a contradiction, so the
      // BG page declares only itself.
      altUrl: route.english?.canonicalUrl === bgUrl ? undefined : enUrl,
      canonicalUrl: route.canonicalUrl,
    },
    route.path === "" ? "index.html" : path.join(route.path, "index.html"),
  );
  // English mirror, if defined for this route.
  if (route.english) {
    writeVariant(
      template,
      route,
      {
        lang: "en",
        title: route.english.title,
        description: route.english.description,
        bodyHtml: route.english.bodyHtml ?? route.bodyHtml,
        jsonLd: route.english.jsonLd ?? route.jsonLd,
        selfUrl: enUrl!,
        altUrl: bgUrl,
        canonicalUrl: route.english.canonicalUrl,
      },
      route.path === ""
        ? path.join("en", "index.html")
        : path.join("en", route.path, "index.html"),
    );
  }
};

const main = async () => {
  const indexPath = path.join(DIST, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `dist/index.html not found at ${indexPath}. Run \`vite build\` first.`,
    );
  }
  const template = fs.readFileSync(indexPath, "utf-8");
  const dynamic = await buildDynamicRoutes(PROJECT_ROOT);
  const all = [...prerenderRoutes, ...dynamic];
  // De-dupe by path (e.g. a static route shouldn't be overwritten by a dynamic one).
  const byPath = new Map<string, PrerenderRoute>();
  for (const r of all) {
    if (!byPath.has(r.path)) byPath.set(r.path, r);
  }
  const routes = Array.from(byPath.values());
  assertBaseMatchesBundle(routes);
  routes.forEach((route) => writeRoute(template, route));
  reportOgFallbacks(routes);
  const englishCount = routes.filter((r) => !!r.english).length;
  console.log(
    `prerendered ${routes.length} routes (${prerenderRoutes.length} static + ${dynamic.length} dynamic, +${englishCount} English mirrors)`,
  );
};

main().catch((err) => {
  console.error("prerender failed:", err);
  process.exit(1);
});
