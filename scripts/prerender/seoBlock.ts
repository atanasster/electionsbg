// The per-route <head> block: title/description/og tags, canonical, hreflang
// alternates, JSON-LD, and the data preload hints.
//
// Split out of index.ts for the same reason dataPreload.ts was — index.ts runs
// main() on import, so nothing in it can be unit tested. The pieces that decide
// what a crawler and a browser see are worth asserting directly, so they live
// here and index.ts keeps only the file-walking shell.
//
// `dataBase` is a parameter rather than module state so a test can pin the
// emitted href without reaching for the environment.

import { DEFAULT_OG_IMAGE, PrerenderRoute, SITE_URL } from "./routes";
import { renderPreloadLinks } from "./dataPreload";
import { escapeHtml } from "./html";

// Inline JSON-LD must escape "</" so a payload string can't break out of the
// <script> tag. https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements
export const safeJsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/<\/(script)/gi, "<\\/$1");

// Per-segment percent-encode so Cyrillic/spaces in the URL emitted to crawlers
// are RFC 3986 compliant. The on-disk path stays raw — Firebase Hosting decodes
// the request before matching against the filesystem, so `dist/candidate/Иван
// Иванов/index.html` is reachable at `/candidate/%D0%98%D0%B2%D0%B0%D0%BD%20...`.
export const encodeUrlPath = (p: string): string =>
  p.split("/").map(encodeURIComponent).join("/");

export type RenderVariant = {
  lang: "bg" | "en";
  title: string;
  description: string;
  bodyHtml?: string;
  jsonLd?: object[];
  selfUrl: string; // URL for og:url
  altUrl?: string; // companion-language URL (for hreflang alternate)
  // If set, <link rel="canonical"> points here instead of selfUrl, and
  // hreflang alternates are suppressed (the canonical target owns them).
  canonicalUrl?: string;
};

// Whether the card a route declares is actually on disk. `() => true` is the
// historical behaviour — assume the generator built it — so a caller that has
// no dist/ to look at (every unit test) reads the route as its only input.
export type CardExists = (distRelativePath: string) => boolean;

// A declared og:image is a PROMISE that a file exists at that URL, and the two
// kinds of card fail differently. The captured ones are committed under
// public/og. The RENDERED families — og/region, og/party, og/local, og/cabinet
// — are written into dist/og at postbuild by scripts/og/generate.ts FROM
// data/<election>/*.json, a tree `.gitignore` excludes (`/data/2*/*`). So on a
// checkout without that data the generator writes nothing, silently, and every
// page in those families used to advertise an og:image that 404s: ~208 of them
// on CI, where the build now fails at scripts/images/optimize.ts's dangling-
// reference gate rather than shipping the dead links.
//
// Falling back to the site-wide card keeps the promise. It is deliberately not
// silent — index.ts reports what it swapped, because on a DEPLOY build (where
// the data is present) a fallback means a card that should exist does not.
export const resolveOgImage = (
  ogImage: string | undefined,
  cardExists: CardExists = () => true,
): string => {
  if (!ogImage) return DEFAULT_OG_IMAGE;
  // An off-site card is somebody else's file — nothing here can check it.
  if (ogImage.startsWith("http")) return ogImage;
  // dist-relative, no leading slash: "og/region/RSE.png". The og/party cards
  // are percent-encoded ON DISK, so the declared path is compared verbatim —
  // decoding it here would miss every one of them.
  const rel = ogImage.replace(/^\//, "");
  if (cardExists(rel)) return `${SITE_URL}${ogImage}`;
  // The card may already be webp: scripts/images/optimize.ts converts dist/og
  // and DELETES the png, so a prerender re-run over an optimized dist sees no
  // .png for a card that is plainly there. Accept the sibling and name it —
  // that is the URL the optimize rewrite would have produced anyway, so the
  // deployed HTML is identical either way. Without this the card would be
  // swapped for the site-wide default, which is the silent half of the defect
  // this function exists to end.
  const webp = rel.replace(/\.(png|jpe?g)$/i, ".webp");
  if (webp !== rel && cardExists(webp)) return `${SITE_URL}/${webp}`;
  return DEFAULT_OG_IMAGE;
};

export const renderSeoBlock = (
  route: PrerenderRoute,
  variant: RenderVariant,
  dataBase: string,
  cardExists?: CardExists,
): string => {
  const ogImage = resolveOgImage(route.ogImage, cardExists);
  const title = escapeHtml(variant.title);
  const description = escapeHtml(variant.description);
  // Twitter falls back to og:title / og:description when twitter-specific
  // tags are absent — drop the redundant pair to save bytes per page.
  // og:image:alt improves accessibility for shared cards.
  const canonicalHref = variant.canonicalUrl ?? variant.selfUrl;
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
    `    <link rel="canonical" href="${canonicalHref}" />`,
  ];
  // Skip hreflang alternates when this page canonicalizes to a different URL —
  // alternates belong on the canonical target, not on the variant pointing at it.
  if (!variant.canonicalUrl) {
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
  }
  if (variant.jsonLd && variant.jsonLd.length) {
    for (const obj of variant.jsonLd) {
      lines.push(
        `    <script type="application/ld+json">${safeJsonLd(obj)}</script>`,
      );
    }
  }
  // Not an SEO tag, but this block is the only per-route seam in the <head> —
  // index.html is a single shared template, so a hint that differs per page has
  // nowhere else to go.
  lines.push(...renderPreloadLinks(route.preloadData, dataBase, escapeHtml));
  lines.push("    <!-- /SEO -->");
  return lines.join("\n");
};
