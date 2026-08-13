// A page is not shipped until it has all THREE of its artifacts: a prerendered
// static page, a sitemap <loc>, and its own og:image. They live in three files,
// none is derived from the others, and every one of them had been forgotten
// somewhere when this file was written (2026-08-13):
//
//   • 28 of 1,185 routes fell through to the site-wide share card, clustered by
//     family — seven /funds sub-pages, five /budget, both /demographics.
//   • /funds/calls declared an ogImage that had NEVER been captured, so both
//     language variants shipped an og:image that 404s.
//   • Six pages (/sofia/*, /consumption/electricity|gas) were in
//     ENGLISH_STATIC_PAGES and in no routeDefs entry, so the sitemap named the
//     English mirror and not the Bulgarian original.
//   • Six more (/governance/sectors — a hub — /demographics/*,
//     /parliament/similarity, /parliament/correlation, /votes/between) were in
//     neither list and had no <loc> at all.
//   • Three had both entries and no <loc>, because `npm run sitemap` is manual
//     and its output is committed.
//
// None of it failed anything. tests/seo.spec.ts asserts og:image
// `toMatch(/^https?:\/\//)`, which BOTH the site-wide fallback and a URL to a
// missing file satisfy; scripts/sitemap/families.data.test.ts checks the other
// direction (every <loc> has a dist/ file behind it).
//
// Each `describe` below carries an anti-vacuity test, because a coverage gate
// that scans nothing passes.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prerenderRoutes } from "./routes";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (p: string) => fs.readFileSync(path.join(REPO, p), "utf8");
const ORIGIN = "https://electionsbg.com";

// ---------------------------------------------------------------------------

describe("every prerendered page has an og:image of its own", () => {
  // Empty on purpose. A page added here needs a REASON, because the fallback is
  // silent — seoBlock.ts drops to DEFAULT_OG_IMAGE with nothing logged, which is
  // how a whole module came to share one picture.
  const EXEMPT = new Set<string>();

  it("no route falls through to the site-wide card", () => {
    const missing = prerenderRoutes
      .filter((r) => !r.ogImage)
      .map((r) => r.path)
      .filter((p) => !EXEMPT.has(p));
    expect(
      missing,
      `no ogImage — these ship the site-wide default card:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("the scan is not vacuous", () => {
    expect(prerenderRoutes.length).toBeGreaterThan(500);
    expect(prerenderRoutes.filter((r) => r.ogImage).length).toBeGreaterThan(
      500,
    );
  });
});

// ---------------------------------------------------------------------------

/** Cards written to public/og by a Playwright capture, vs. rendered at postbuild
 *  into dist/og by scripts/og/generate.ts. The second kind is NOT on disk in a
 *  fresh checkout, so it is verified against the generator's SOURCE — a
 *  different artifact from routes.ts, which is the point. */
const generatorSource = read("scripts/og/generate.ts");

const hasProducer = (ogImage: string): boolean => {
  if (ogImage.startsWith("http")) return true;
  const rel = ogImage.replace(/^\//, "");
  if (fs.existsSync(path.join(REPO, "public", rel))) return true;
  // generate.ts queues cards by a path relative to og/ ("about.png",
  // "cabinet/<id>.png", "party/<name>.png"). Templated families are matched on
  // their directory prefix.
  const underOg = rel.replace(/^og\//, "");
  if (generatorSource.includes(`"${underOg}"`)) return true;
  const dir = underOg.includes("/") ? underOg.split("/")[0] : null;
  return dir ? generatorSource.includes(`\`${dir}/`) : false;
};

describe("every declared og:image has something that produces it", () => {
  it("no route points at a card nothing writes", () => {
    const broken = prerenderRoutes
      .filter((r) => r.ogImage && !hasProducer(r.ogImage))
      .map((r) => `${r.path} -> ${r.ogImage}`);
    expect(
      broken,
      `og:image with no producer — the crawler gets a 404 image:\n${broken.join("\n")}`,
    ).toEqual([]);
  });

  it("the producer check is not vacuous — it rejects a fabricated card", () => {
    // Without this, a `hasProducer` that returned true unconditionally (a
    // widened prefix rule, say) would leave the gate green for ever.
    expect(hasProducer("/og/no-such-card-abc123.png")).toBe(false);
    expect(hasProducer("/og/funds-places.png")).toBe(true); // a captured file
    expect(hasProducer("/og/about.png")).toBe(true); // a generate.ts card
  });
});

// ---------------------------------------------------------------------------

describe("every captured card is referenced by a page", () => {
  // A card that was shot and wired to nothing is the mirror of the defect above.
  // /funds/focus was in exactly that state: public/og/funds-focus.png existed and
  // every /funds/focus/<slug> child used it, while the index that fronts them
  // carried no ogImage at all.
  //
  // Matched against the SOURCE of both route files rather than the built route
  // list, because dynamicRoutes builds many hrefs from template literals.
  const routeSources =
    read("scripts/prerender/routes.ts") +
    read("scripts/prerender/dynamicRoutes.ts");

  const captureSlugs = [
    ...read("scripts/og/capture-screens.ts").matchAll(
      /^\s+slug: "([^"$]+)",$/gm,
    ),
  ].map((m) => m[1]);

  it("finds the capture table", () => {
    expect(captureSlugs.length).toBeGreaterThan(30);
  });

  // A whole FAMILY of cards is often referenced from one template literal —
  // `/og/reports-${type}.png` covers nine slugs — so a plain substring test
  // reports all nine as orphans. Collect the literal prefix of every such
  // template and treat a slug it prefixes as referenced.
  //
  // LIMIT, stated: this cannot tell whether the template's own guard (here
  // `OG_REPORT_SLUGS`) actually emits THIS slug — only that the family is
  // wired. A slug wrongly added to a covered family is invisible here. It still
  // catches the case it exists for: a card referenced from nowhere at all.
  const templatePrefixes = [
    ...routeSources.matchAll(/\/og\/([a-z0-9/-]*)\$\{/g),
  ].map((m) => m[1]);

  const referenced = (slug: string) =>
    routeSources.includes(`/og/${slug}.png`) ||
    templatePrefixes.some((p) => p !== "" && slug.startsWith(p));

  it("finds the template-built families too", () => {
    expect(templatePrefixes.length).toBeGreaterThan(2);
  });

  it("no capture writes a card no page points at", () => {
    const orphans = captureSlugs.filter((s) => !referenced(s));
    expect(
      orphans,
      `captured but referenced by no route: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("the reference check is not vacuous", () => {
    // Both directions: an unreferenced slug is caught, and the prefix rule has
    // not widened to the point of matching anything.
    expect(referenced("no-such-card-abc123")).toBe(false);
    expect(referenced("funds-places")).toBe(true);
    expect(referenced("reports-turnout")).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("every prerendered page is in the committed sitemap", () => {
  // Read the ARTIFACT, not a fresh enumeration: `npm run sitemap` is manual and
  // its output is committed, so "both route_defs entries are present" is not the
  // same claim as "the page has a <loc>". Three /budget pages were in that gap.
  const locs = new Set<string>();
  for (const f of fs.readdirSync(path.join(REPO, "public"))) {
    if (!/^sitemap.*\.xml$/.test(f) || f === "sitemap_index.xml") continue;
    for (const m of read(`public/${f}`).matchAll(/<loc>([^<]+)<\/loc>/g))
      locs.add(decodeURIComponent(m[1].replace(ORIGIN, "")));
  }

  it("finds the committed sitemap", () => {
    expect(locs.size).toBeGreaterThan(100_000);
  });

  it("every route has a Bulgarian <loc>", () => {
    // A page that canonicalises elsewhere must NOT be listed — asking Google to
    // index a URL that points somewhere else is worse than omitting it.
    const missing = prerenderRoutes
      .filter((r) => !r.canonicalUrl && !locs.has(`/${r.path}`))
      .map((r) => r.path);
    expect(
      missing,
      `prerendered with no sitemap <loc>. If both route_defs entries are already there, run \`npm run sitemap\` and commit public/sitemap*.xml:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("every route with an English mirror has an /en <loc>", () => {
    // Same rule on the English side, and the discriminator is the mirror's own
    // `english.canonicalUrl` — 987 funds procedures and 11 programmes point back
    // at the Bulgarian URL because ИСУН publishes no English names for them, and
    // the enumerators skip those deliberately.
    const missing = prerenderRoutes
      .filter(
        (r) =>
          r.english &&
          !r.canonicalUrl &&
          !r.english.canonicalUrl &&
          r.path !== "" &&
          !locs.has(`/en/${r.path}`),
      )
      .map((r) => r.path);
    expect(
      missing,
      `has an english: block but no /en <loc> — adding only the routeDefs entry lists the original and not the mirror:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("a canonicalised page is genuinely absent, so the exemption is not free", () => {
    // /data-changes 301s onto /data/updates. If it ever appeared in the sitemap
    // the two clauses above would both pass while the artifact was wrong.
    expect(locs.has("/data-changes")).toBe(false);
  });
});
