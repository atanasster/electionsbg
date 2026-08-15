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
import { ENGLISH_STATIC_PAGES, routeDefs } from "../sitemap/route_defs";
import { SITE_ORIGIN } from "@/lib/siteOrigin";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (p: string) => fs.readFileSync(path.join(REPO, p), "utf8");
const ORIGIN = SITE_ORIGIN;

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

describe("every routed page is DECLARED — for prerender and for the sitemap", () => {
  // ⚠️ THE THIRD WAY A PAGE SHIPS UNFINISHED, and the one nothing checked. The
  // two describes above ask „does this declared page have its card / its <loc>".
  // This one asks the prior question: is the page declared AT ALL?
  //
  // A route in neither `scripts/prerender/routes.ts` nor
  // `scripts/sitemap/route_defs.ts` still WORKS — Firebase's catch-all serves
  // the SPA shell — so it renders correctly for a human and hands a crawler the
  // HOMEPAGE's <title>, description and canonical. That is the duplicate-content
  // shape CLAUDE.md documents for `/funds/contract/**` and `/company/**`, and it
  // is silent in every direction: no 404, no console error, nothing red.
  //
  // Found 2026-08-15 on `/budget/deep-dive`, routed and linked from its hub for
  // the whole migration.

  /** Routed, non-parameterised paths, read from the router itself.
   *
   *  ⚠️ REACT ROUTER NESTS, so a bare `path="analysis"` is only a SEGMENT — its
   *  full path is `parliamentary/analysis`. A flat scan reports those segments
   *  as undeclared pages, which is a gate nobody can act on. There are exactly
   *  five parent groups here (`<Route path="X">` with a bare `>` rather than a
   *  self-close), so the prefix is resolved from their spans. */
  const routerSrc = read("src/routes.tsx");
  const parentSpans: Array<{ from: number; to: number; seg: string }> = [];
  for (const m of routerSrc.matchAll(/<Route\s+path="([^"]+)"\s*>/g)) {
    const from = (m.index ?? 0) + m[0].length;
    const to = routerSrc.indexOf("</Route>", from);
    if (to > from) parentSpans.push({ from, to, seg: m[1] });
  }
  const prefixAt = (pos: number): string =>
    parentSpans.find((sp) => pos >= sp.from && pos < sp.to)?.seg ?? "";
  /** A route whose element is `<Navigate>` is a REDIRECT, not a page — it has
   *  no head to get wrong. Five of them (`/analysis`, `/reports`,
   *  `/data-changes`, `/parliamentary/reports`, `/procurement/roads`) are old
   *  flat paths kept pointing at their namespaced replacements. */
  const isRedirect = (at: number): boolean =>
    /element=\{\s*<Navigate/.test(routerSrc.slice(at, at + 400));
  const routed = [...routerSrc.matchAll(/path="([^"]+)"/g)]
    .filter((m) => !isRedirect(m.index ?? 0))
    .map((m) => {
      const seg = m[1];
      const pre = prefixAt(m.index ?? 0);
      return pre && seg !== pre ? `${pre}/${seg}` : seg;
    })
    .filter((p) => p && p !== "*" && !p.includes(":"))
    .filter((p, i, a) => a.indexOf(p) === i)
    .sort();

  /** Declared for prerender — the module, not a substring scan of its source. */
  const prerendered = new Set(prerenderRoutes.map((r) => r.path));
  /** Declared for the sitemap. BOTH lists: `routeDefs()` carries the Bulgarian
   *  pages, `ENGLISH_STATIC_PAGES` their /en mirrors — and `route_defs.ts`'s own
   *  Sofia note records the last time only one of them was filled, after which
   *  the sitemap named /en/… and no canonical. Imported rather than grepped:
   *  slicing that file by `indexOf` markers silently passes a path present in
   *  one list only, which is the very defect. */
  const bg = new Set(routeDefs("2026_04_19").map((d) => d.path));
  const en = new Set<string>(ENGLISH_STATIC_PAGES);

  const gapsFor = (p: string): string[] => {
    const gaps: string[] = [];
    if (!prerendered.has(p)) gaps.push("no staticPage");
    if (!bg.has(p)) gaps.push("not in routeDefs()");
    if (!en.has(p)) gaps.push("not in ENGLISH_STATIC_PAGES");
    return gaps;
  };

  // ⚠️ ENFORCED FOR /budget ONLY, and that is a scope decision rather than a
  // belief that the rest is clean. Measured 2026-08-15: 30 routed paths across
  // the site are undeclared somewhere. Most are almost certainly deliberate —
  // report sub-views, redirect components, server-driven browsers — but NOTHING
  // RECORDS WHICH, and turning that into 30 exemptions I cannot justify would be
  // a worse artifact than a scoped gate that says so. The machinery above is
  // family-agnostic; widening it is adding a family to this list after deciding
  // its pages one at a time.
  const ENFORCED = ["budget"];

  it("declares every routed /budget page in all three places", () => {
    const missing = routed
      .filter((p) => ENFORCED.some((f) => p === f || p.startsWith(`${f}/`)))
      // The parameterised family is enumerated from Postgres at sitemap time,
      // not declared as a static page.
      .filter((p) => !p.startsWith("budget/ministry"))
      .map((p) => ({ p, gaps: gapsFor(p) }))
      .filter(({ gaps }) => gaps.length)
      .map(({ p, gaps }) => `${p}: ${gaps.join(", ")}`);
    expect(
      missing,
      `routed but undeclared — Firebase serves these the homepage's head:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("records the site-wide gap rather than leaving it unmeasured", () => {
    // Not a pass/fail on the other families — a tripwire on the NUMBER. If it
    // grows, someone added a page in the same half-finished state; if it shrinks,
    // this bound should come down with it. The three named below are the ones
    // that matter most, because each is LINKED from prerendered copy, so a
    // crawler is walked straight into the homepage's head.
    // 67 as measured 2026-08-15, redirects already excluded. Most are sub-views
    // of a PARAMETERISED parent — `municipality/invalid_ballots` lives under
    // `/municipality/:code` and can never be one static page — so the true
    // number needing a decision is far smaller. The bound catches GROWTH, which
    // is what „someone shipped another half-declared page" looks like.
    const undeclared = routed.filter((p) => gapsFor(p).length > 0);
    expect(undeclared.length).toBeLessThanOrEqual(67);
    for (const p of [
      "procurement/tenders",
      "sofia/companies",
      "sector/administration/services",
    ]) {
      expect(routed, `${p} is no longer routed — update this list`).toContain(
        p,
      );
    }
  });

  it("keeps a prerendered page's English mirror declared with it", () => {
    // `ENGLISH_STATIC_PAGES` is what mints the /en <loc>; a `staticPage` with no
    // `english:` block has no English body for it to point at.
    const noEnglish = prerenderRoutes
      .filter((r) => en.has(r.path) && !r.english)
      .map((r) => r.path);
    expect(noEnglish).toEqual([]);
  });

  it("the declaration check is not vacuous", () => {
    expect(routed.length).toBeGreaterThan(150);
    // The nesting resolver works: this path exists only as a bare `analysis`
    // segment inside `<Route path="parliamentary">`.
    expect(routed).toContain("parliamentary/analysis");
    // `/analysis` is ALSO routed — as a `<Navigate>` to the namespaced path — so
    // „not in the list" here proves the redirect filter, not the nesting. Both
    // properties are pinned, because a first cut asserted the wrong one and read
    // the resolver as broken when it was right.
    expect(routed).not.toContain("analysis");
    expect(routerSrc).toContain('path="analysis"');
    // A real page passes all three, a fabricated one fails all three.
    expect(gapsFor("budget/deep-dive")).toEqual([]);
    expect(gapsFor("budget/no-such-page-abc123")).toHaveLength(3);
    // …and the two sitemap lists are genuinely distinct sets, so checking one is
    // not accidentally checking both.
    expect(bg.has("budget/ministry/:id")).toBe(true);
    expect(en.has("budget/ministry/:id")).toBe(false);
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
