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
const BODY_BLOCK_RE = /<!-- BODY -->([\s\S]*?)<!-- \/BODY -->/;

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

type RenderVariant = {
  lang: "bg" | "en";
  title: string;
  description: string;
  bodyHtml?: string;
  jsonLd?: object[];
  selfUrl: string; // canonical URL for this variant
  altUrl?: string; // companion-language URL (for hreflang alternate)
};

const renderSeoBlock = (
  route: PrerenderRoute,
  variant: RenderVariant,
): string => {
  const ogImage = route.ogImage
    ? route.ogImage.startsWith("http")
      ? route.ogImage
      : `${SITE_URL}${route.ogImage}`
    : DEFAULT_OG_IMAGE;
  const title = escapeHtml(variant.title);
  const description = escapeHtml(variant.description);
  // Twitter falls back to og:title / og:description when twitter-specific
  // tags are absent — drop the redundant pair to save bytes per page.
  // og:image:alt improves accessibility for shared cards.
  const lines = [
    "<!-- SEO -->",
    `    <title>${title}</title>`,
    `    <meta name="description" content="${description}" />`,
    `    <meta property="og:title" content="${title}" />`,
    `    <meta property="og:description" content="${description}" />`,
    `    <meta property="og:url" content="${variant.selfUrl}" />`,
    `    <meta property="og:image" content="${ogImage}" />`,
    `    <meta property="og:image:alt" content="${title}" />`,
    `    <meta property="og:locale" content="${variant.lang === "en" ? "en_US" : "bg_BG"}" />`,
    `    <meta name="twitter:image" content="${ogImage}" />`,
    `    <link rel="canonical" href="${variant.selfUrl}" />`,
  ];
  if (variant.altUrl) {
    // Bidirectional hreflang — each language declares both itself and the
    // alternate; x-default points to the BG (default) variant.
    const bgUrl = variant.lang === "bg" ? variant.selfUrl : variant.altUrl;
    const enUrl = variant.lang === "en" ? variant.selfUrl : variant.altUrl;
    lines.push(`    <link rel="alternate" hreflang="bg" href="${bgUrl}" />`);
    lines.push(`    <link rel="alternate" hreflang="en" href="${enUrl}" />`);
    lines.push(
      `    <link rel="alternate" hreflang="x-default" href="${bgUrl}" />`,
    );
  } else {
    lines.push(
      `    <link rel="alternate" hreflang="bg" href="${variant.selfUrl}" />`,
    );
    lines.push(
      `    <link rel="alternate" hreflang="x-default" href="${variant.selfUrl}" />`,
    );
  }
  if (variant.jsonLd && variant.jsonLd.length) {
    for (const obj of variant.jsonLd) {
      lines.push(
        `    <script type="application/ld+json">${safeJsonLd(obj)}</script>`,
      );
    }
  }
  lines.push("    <!-- /SEO -->");
  return lines.join("\n");
};

const renderBodyBlock = (variant: RenderVariant): string => {
  const inner = variant.bodyHtml ?? "";
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
  let html = template.replace(SEO_BLOCK_RE, renderSeoBlock(route, variant));
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

const enUrlFor = (route: PrerenderRoute): string =>
  route.path === ""
    ? `${SITE_URL}/en/`
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
      altUrl: enUrl,
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
  routes.forEach((route) => writeRoute(template, route));
  const englishCount = routes.filter((r) => !!r.english).length;
  console.log(
    `prerendered ${routes.length} routes (${prerenderRoutes.length} static + ${dynamic.length} dynamic, +${englishCount} English mirrors)`,
  );
};

main().catch((err) => {
  console.error("prerender failed:", err);
  process.exit(1);
});
