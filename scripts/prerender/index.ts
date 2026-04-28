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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DIST = path.join(PROJECT_ROOT, "dist");

const SEO_BLOCK_RE = /<!-- SEO -->([\s\S]*?)<!-- \/SEO -->/;

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Inline JSON-LD must escape "</" so a payload string can't break out of the
// <script> tag. https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements
const safeJsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/<\/(script)/gi, "<\\/$1");

// Per-segment percent-encode so Cyrillic/spaces in the URL emitted to crawlers
// are RFC 3986 compliant. The on-disk path stays raw — Firebase Hosting decodes
// the request before matching against the filesystem, so `dist/candidate/Иван
// Иванов/index.html` is reachable at `/candidate/%D0%98%D0%B2%D0%B0%D0%BD%20...`.
const encodeUrlPath = (p: string): string =>
  p.split("/").map(encodeURIComponent).join("/");

const renderSeoBlock = (route: PrerenderRoute): string => {
  const url =
    route.path === ""
      ? `${SITE_URL}/`
      : `${SITE_URL}/${encodeUrlPath(route.path)}`;
  const ogImage = route.ogImage
    ? route.ogImage.startsWith("http")
      ? route.ogImage
      : `${SITE_URL}${route.ogImage}`
    : DEFAULT_OG_IMAGE;
  const title = escapeHtml(route.title);
  const description = escapeHtml(route.description);
  const lines = [
    "<!-- SEO -->",
    `    <title>${title}</title>`,
    `    <meta name="description" content="${description}" />`,
    `    <meta property="og:title" content="${title}" />`,
    `    <meta property="og:description" content="${description}" />`,
    `    <meta property="og:url" content="${url}" />`,
    `    <meta property="og:image" content="${ogImage}" />`,
    `    <meta name="twitter:title" content="${title}" />`,
    `    <meta name="twitter:description" content="${description}" />`,
    `    <meta name="twitter:image" content="${ogImage}" />`,
    `    <link rel="canonical" href="${url}" />`,
    `    <link rel="alternate" hreflang="bg" href="${url}" />`,
    `    <link rel="alternate" hreflang="x-default" href="${url}" />`,
  ];
  if (route.jsonLd && route.jsonLd.length) {
    for (const obj of route.jsonLd) {
      lines.push(
        `    <script type="application/ld+json">${safeJsonLd(obj)}</script>`,
      );
    }
  }
  lines.push("    <!-- /SEO -->");
  return lines.join("\n");
};

const writeRoute = (template: string, route: PrerenderRoute) => {
  if (!SEO_BLOCK_RE.test(template)) {
    throw new Error(
      "dist/index.html is missing the <!-- SEO --> ... <!-- /SEO --> block. " +
        "The prerender step requires this placeholder to inject route-specific tags.",
    );
  }
  const html = template.replace(SEO_BLOCK_RE, renderSeoBlock(route));
  const outPath =
    route.path === ""
      ? path.join(DIST, "index.html")
      : path.join(DIST, route.path, "index.html");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf-8");
};

const main = () => {
  const indexPath = path.join(DIST, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `dist/index.html not found at ${indexPath}. Run \`vite build\` first.`,
    );
  }
  const template = fs.readFileSync(indexPath, "utf-8");
  const dynamic = buildDynamicRoutes(PROJECT_ROOT);
  const all = [...prerenderRoutes, ...dynamic];
  // De-dupe by path (e.g. a static route shouldn't be overwritten by a dynamic one).
  const byPath = new Map<string, PrerenderRoute>();
  for (const r of all) {
    if (!byPath.has(r.path)) byPath.set(r.path, r);
  }
  const routes = Array.from(byPath.values());
  routes.forEach((route) => writeRoute(template, route));
  console.log(
    `prerendered ${routes.length} routes (${prerenderRoutes.length} static + ${dynamic.length} dynamic)`,
  );
};

main();
