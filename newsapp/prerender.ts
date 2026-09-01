// Per-route <head> for the news app, and a sitemap generated from the corpus.
//
// ⚠️ WHY THIS EXISTS. The app is a plain SPA behind a catch-all rewrite, so
// every URL was served the SAME index.html — with the homepage's <title>,
// description and canonical. To a crawler that made all 86 story pages and all
// 71 outlet pages duplicates of the homepage, which is exactly the shape
// CLAUDE.md documents for /funds/contract/** and /company/** on the main site,
// and the reason those two families are function-served there.
//
// The sitemap was worse: four hard-coded URLs, so a story added tonight was
// invisible to a crawler by omission and nothing would ever say so.
//
// ⚠️ THIS IS NOT REACT SSR. It does not render the app — it writes a
// per-route <head> into a copy of the built index.html, which is what fixes
// the duplicate-content problem. The body is still hydrated by the SPA. That
// distinction matters if someone later expects the text to be in the HTML:
// it is not, and making it so is a separate (larger) change.
//
// ⚠️ NO TRAILING SLASH, ANYWHERE. hosting.news runs `trailingSlash: false`, so
// `dist-news/<path>/index.html` serves at `/<path>` and `/<path>/` 301s back
// to it. A canonical or a <loc> written with a slash names a URL that
// redirects — the defect that sat on ~248k main-site pages until 2026-08-03.

import fs from "node:fs";
import path from "node:path";
import { NEWS_SITE, newsUrlFor } from "./app/site";

export const SITE = NEWS_SITE;

export type PrerenderRoute = {
  /** Path WITHOUT a trailing slash. "" is the root. */
  path: string;
  title: string;
  description: string;
  /** English metadata used to mint the equivalent /en route. */
  titleEn?: string;
  descriptionEn?: string;
  /** Defaults to Bulgarian. English routes live under /en. */
  language?: "bg" | "en";
  /** og:type — "website" for hubs, "article" for a single story/article. */
  ogType?: string;
  /** Absolute image URL. Falls back to the site icon. */
  image?: string | null;
  /** ISO date for <lastmod>. Omitted from the sitemap when absent. */
  lastmod?: string | null;
  /**
   * Whether the page belongs in the sitemap.
   *
   * ⚠️ Not every prerendered page should be submitted. A thin page — one
   * title and a couple of rows — earns a thin-content penalty rather than
   * traffic, which is why the main site prerenders /council/resolution/** and
   * deliberately gives it no <loc>. Same rule here.
   */
  sitemap?: boolean;
  /** Utility/personal pages may be linked for humans but excluded from search. */
  noindex?: boolean;
};

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** One-line, collapsed, and cut on a word boundary. */
export const clamp = (raw: string, max = 155): string => {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
};

/** Absolute, slash-free URL for a route path. */
export const urlFor = (routePath: string): string => {
  return newsUrlFor(routePath);
};

/**
 * Rewrite the head of a built index.html for one route.
 *
 * Every replacement is anchored on the exact tag the template carries, and
 * `applyHead` REPORTS what it could not find rather than silently emitting a
 * page with the homepage's title — a prerender that fails open is worse than
 * no prerender, because it looks like it worked.
 */
export const applyHead = (
  html: string,
  route: PrerenderRoute,
): { html: string; missing: string[] } => {
  const url = urlFor(route.path);
  const title = esc(route.title);
  // ⚠️ NOT clamped here. The hub descriptions are hand-written meta copy and
  // clamping silently rewrote them (the homepage's went 164 -> 147 chars, and
  // gained an ellipsis, on every build). Generated descriptions are clamped
  // where they are BUILT, in prerenderRoutes, which is the only place that
  // knows a string came from a summary rather than from a person.
  const description = esc(route.description.replace(/\s+/g, " ").trim());
  const missing: string[] = [];
  const language = route.language ?? "bg";

  const swap = (pattern: RegExp, replacement: string, label: string) => {
    if (!pattern.test(html)) {
      missing.push(label);
      return;
    }
    // ⚠️ A FUNCTION replacement, never a string. String.replace interprets
    // `$&`, `$\``, `$'` and `$$` inside the replacement — and the
    // replacement is built from somebody else's HEADLINE. Reproduced: a title
    // containing `$&` produced a nested <title> tag, and a description
    // containing `$'` injected the rest of the document into the content
    // attribute. Four story fields in the corpus already carry `$`.
    html = html.replace(pattern, () => replacement);
  };

  swap(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`, "title");
  html = html.replace(/<html\s+lang="[^"]*"/, `<html lang="${language}"`);
  swap(
    /<meta\s+name="description"[^<>]*?\/?>/,
    `<meta name="description" content="${description}" />`,
    "description",
  );
  if (route.noindex && !/<meta\s+name="robots"/i.test(html)) {
    html = html.replace(
      /<\/head>/,
      '<meta name="robots" content="noindex,follow" />\n</head>',
    );
  }
  swap(
    /<link rel="canonical" href="[^"]*"\s*\/?>/,
    `<link rel="canonical" href="${url}" />`,
    "canonical",
  );
  swap(
    /<meta property="og:url" content="[^"]*"\s*\/?>/,
    `<meta property="og:url" content="${url}" />`,
    "og:url",
  );
  swap(
    /<meta property="og:title" content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${title}" />`,
    "og:title",
  );
  swap(
    /<meta property="og:site_name" content="[^"]*"\s*\/?>/,
    `<meta property="og:site_name" content="${language === "en" ? "Naiasno News" : "Наясно Новини"}" />`,
    "og:site_name",
  );
  swap(
    /<meta\s+property="og:description"[^<>]*?\/?>/,
    `<meta property="og:description" content="${description}" />`,
    "og:description",
  );
  swap(
    /<meta property="og:type" content="[^"]*"\s*\/?>/,
    `<meta property="og:type" content="${esc(route.ogType ?? "website")}" />`,
    "og:type",
  );
  swap(
    /<meta name="twitter:title" content="[^"]*"\s*\/?>/,
    `<meta name="twitter:title" content="${title}" />`,
    "twitter:title",
  );
  swap(
    /<meta\s+name="twitter:description"[^<>]*?\/?>/,
    `<meta name="twitter:description" content="${description}" />`,
    "twitter:description",
  );
  if (route.image) {
    // ⚠️ Only when we have one. Replacing the site icon with a broken outlet
    // URL would give every share card a missing image — and roughly a quarter
    // of outlets refuse a cross-origin request for their photos, which a
    // social scraper makes exactly like we do.
    swap(
      /<meta property="og:image" content="[^"]*"\s*\/?>/,
      `<meta property="og:image" content="${esc(route.image)}" />`,
      "og:image",
    );
  }
  const counterpartPath =
    language === "en"
      ? route.path.replace(/^en(?:\/|$)/, "")
      : route.path
        ? `en/${route.path}`
        : "en";
  const bgPath = language === "en" ? counterpartPath : route.path;
  const enPath = language === "en" ? route.path : counterpartPath;
  const alternates =
    `<link rel="alternate" hreflang="bg" href="${esc(urlFor(bgPath))}" />\n` +
    `<link rel="alternate" hreflang="en" href="${esc(urlFor(enPath))}" />\n` +
    `<link rel="alternate" hreflang="x-default" href="${esc(urlFor(bgPath))}" />\n`;
  html = html.replace(/<\/head>/, `${alternates}</head>`);
  if (language === "en") {
    const structuredData = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Naiasno News",
      url: urlFor("en"),
      inLanguage: "en",
      applicationCategory: "NewsApplication",
      description:
        "Independent comparison of Bulgarian media coverage, political framing, stance toward Russia, topics, and sources.",
      isPartOf: "https://electionsbg.com/en",
      offers: { "@type": "Offer", price: "0", priceCurrency: "BGN" },
    });
    html = html.replace(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
      `<script type="application/ld+json">${structuredData}</script>`,
    );
    html = html.replace(
      /<noscript>[\s\S]*?<\/noscript>/,
      `<noscript><div style="font-family: system-ui; max-width: 40rem; margin: 4rem auto; padding: 0 1rem"><h1>Naiasno News</h1><p>This application compares how Bulgarian media cover the same stories. JavaScript is required. Visit <a href="https://electionsbg.com/en">electionsbg.com</a> for the main site.</p></div></noscript>`,
    );
  }
  return { html, missing };
};

export const renderSitemap = (routes: PrerenderRoute[]): string => {
  const entries = routes
    .filter((r) => r.sitemap !== false)
    .map((r) => {
      const lastmod = r.lastmod
        ? `<lastmod>${r.lastmod.slice(0, 10)}</lastmod>`
        : "";
      const language = r.language ?? "bg";
      const counterpartPath =
        language === "en"
          ? r.path.replace(/^en(?:\/|$)/, "")
          : r.path
            ? `en/${r.path}`
            : "en";
      const bgPath = language === "en" ? counterpartPath : r.path;
      const enPath = language === "en" ? r.path : counterpartPath;
      return `  <url><loc>${esc(urlFor(r.path))}</loc>${lastmod}<xhtml:link rel="alternate" hreflang="bg" href="${esc(urlFor(bgPath))}"/><xhtml:link rel="alternate" hreflang="en" href="${esc(urlFor(enPath))}"/><xhtml:link rel="alternate" hreflang="x-default" href="${esc(urlFor(bgPath))}"/></url>`;
    });
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    entries.join("\n") +
    "\n</urlset>\n"
  );
};

/**
 * A route path that is safe to turn into a directory, or null.
 *
 * ⚠️ Route paths are built from CORPUS DATA — a domain and a story id — and
 * `path.join` NORMALISES `..`, so `outlet/../../escaped` wrote a file outside
 * the output directory. Reproduced. Clean in today's corpus and one bad
 * registry row away from not being.
 */
export const safeSegment = (routePath: string): string | null => {
  const clean = routePath.replace(/^\/+|\/+$/g, "");
  if (!clean) return "";
  if (clean.includes("\0")) return null;
  // Decoded first: %2e%2e%2f is `../` to a filesystem too.
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    return null;
  }
  const parts = decoded.split(/[/\\]/);
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  if (/^[a-zA-Z]:/.test(decoded)) return null; // a Windows drive letter
  return clean;
};

/** Write one route's index.html under `outDir`. Returns unmatched head tags. */
export const writeRoute = (
  outDir: string,
  template: string,
  route: PrerenderRoute,
): string[] => {
  const clean = safeSegment(route.path);
  if (clean === null) {
    throw new Error(
      `prerender: refusing to write route ${JSON.stringify(route.path)} — ` +
        "it does not resolve to a path inside the output directory",
    );
  }
  const { html, missing } = applyHead(template, route);
  const dir = clean ? path.join(outDir, clean) : outDir;
  const resolved = path.resolve(dir);
  // Belt and braces, and PROVABLY UNREACHABLE today — mutation testing
  // confirms: deleting this branch changes no test, because safeSegment
  // already refuses every input that could reach it. Kept deliberately as the
  // second half of a security check: if safeSegment is ever loosened, this is
  // what stops a write landing outside the output directory, and it costs one
  // path.resolve per page.
  if (
    resolved !== path.resolve(outDir) &&
    !resolved.startsWith(path.resolve(outDir) + path.sep)
  ) {
    throw new Error(
      `prerender: route ${JSON.stringify(route.path)} resolves outside ` +
        `${outDir}`,
    );
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
  return missing;
};
